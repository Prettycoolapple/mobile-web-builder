import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import {
  canRequestSubdivision,
  fetchSubdivisionSite,
  solveSubdivisionScenario,
  SUBDIVISION_SCENARIO_IDS,
  SubdivisionError,
  type SubdivisionScenario,
  type SubdivisionScenarioId,
  type SubdivisionSiteResult,
  type SubdivisionTarget,
} from "@/lib/subdivision";

/**
 * Drives the AI Subdivision feature: the gating site lookup, then the two
 * scenario solves.
 *
 * The two solves are deliberately **separate parallel requests**. Asking the
 * server for both in one call makes it solve them serially (roughly double the
 * wall clock, since the solver is synchronous CPU work), and it would also mean
 * neither result appears until the slower one lands. Run separately, each card
 * fills in the moment its own scenario returns.
 */

/** Parcel/zone facts effectively never change within a session. */
const SITE_STALE_TIME_MS = 60 * 60 * 1000;
const SITE_GC_TIME_MS = 24 * 60 * 60 * 1000;
/**
 * "Unsupported" is cached for far less time than a supported answer, because the
 * two are not equally trustworthy. Rubin reports *any* 404 as unsupported —
 * including a 404 for the route itself, which is what a mid-deploy Rubin returns
 * for every address in the country. Caching that for an hour greys the button
 * out long after Rubin has recovered, with no way for the user to retry.
 *
 * A supported answer cannot be wrong in that way, so it keeps the full hour.
 */
const SITE_UNSUPPORTED_STALE_TIME_MS = 60 * 1000;

export type ScenarioRunState =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "done"; scenario: SubdivisionScenario; cached: boolean }
  | { status: "empty" }
  | { status: "failed"; message: string; retryable: boolean };

export interface SubdivisionState {
  /** True once the gating lookup says Rubin can analyse this parcel. */
  available: boolean;
  siteLoading: boolean;
  /** Present whether or not the site is supported; drives the honest copy. */
  siteResult: SubdivisionSiteResult | undefined;
  /** Set when the gating lookup itself failed (network/upstream) — retryable. */
  siteError: SubdivisionError | null;
  retrySite: () => void;

  runs: Record<SubdivisionScenarioId, ScenarioRunState>;
  hasStarted: boolean;
  isSolving: boolean;
  /** Seconds since the run began — the honest substitute for a progress bar. */
  elapsedSeconds: number;
  solvedScenarios: SubdivisionScenario[];
  /** Reported by the solver; shown so a stale cached result is attributable. */
  solverVersion: string | null;
  selectedScenarioId: SubdivisionScenarioId | null;
  selectScenario: (id: SubdivisionScenarioId) => void;
  start: () => void;
  reset: () => void;
}

const IDLE_RUNS: Record<SubdivisionScenarioId, ScenarioRunState> = {
  "max-yield": { status: "idle" },
  "high-end": { status: "idle" },
};

export function subdivisionSiteQueryKey(target: SubdivisionTarget) {
  return ["subdivision-site", target.address ?? null, target.lat ?? null, target.lng ?? null] as const;
}

export function useSubdivision(target: SubdivisionTarget): SubdivisionState {
  const { getApiHeaders } = useAuth();
  const [runs, setRuns] = useState<Record<SubdivisionScenarioId, ScenarioRunState>>(IDLE_RUNS);
  const [hasStarted, setHasStarted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedScenarioId, setSelectedScenarioId] = useState<SubdivisionScenarioId | null>(null);
  const [solverVersion, setSolverVersion] = useState<string | null>(null);
  // Guards against a resolved solve writing into state after the component has
  // unmounted or the user has moved to another property — a real risk when the
  // request can legitimately be in flight for minutes.
  const runIdRef = useRef(0);

  const canRequest = canRequestSubdivision(target);
  const targetKey = `${target.address ?? ""}|${target.lat ?? ""}|${target.lng ?? ""}`;

  const siteQuery = useQuery({
    queryKey: subdivisionSiteQueryKey(target),
    enabled: canRequest,
    staleTime: (query) =>
      query.state.data?.supported === false ? SITE_UNSUPPORTED_STALE_TIME_MS : SITE_STALE_TIME_MS,
    gcTime: SITE_GC_TIME_MS,
    // One retry only: an unsupported site is a 200, so a throw here is a genuine
    // network/upstream fault, and the user can retry by hand from the UI.
    retry: 1,
    queryFn: () => fetchSubdivisionSite(target, getApiHeaders()),
  });

  // A new property means the previous property's scenarios are meaningless.
  useEffect(() => {
    runIdRef.current += 1;
    setRuns(IDLE_RUNS);
    setHasStarted(false);
    setStartedAt(null);
    setElapsedSeconds(0);
    setSelectedScenarioId(null);
    setSolverVersion(null);
  }, [targetKey]);

  const isSolving = useMemo(
    () => SUBDIVISION_SCENARIO_IDS.some((id) => runs[id].status === "running"),
    [runs],
  );

  // Tick only while something is in flight. A cold solve can run for minutes and
  // a visible, moving elapsed counter is what distinguishes "still working" from
  // "frozen" — the difference between a user waiting and a user force-quitting.
  useEffect(() => {
    if (!isSolving || startedAt === null) return;
    setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isSolving, startedAt]);

  const start = useCallback(() => {
    if (!canRequest) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const begunAt = Date.now();

    setHasStarted(true);
    setStartedAt(begunAt);
    setElapsedSeconds(0);
    setSelectedScenarioId(null);
    setRuns({
      "max-yield": { status: "running", startedAt: begunAt },
      "high-end": { status: "running", startedAt: begunAt },
    });

    const headers = getApiHeaders();
    // Fired as two independent promises, NOT Promise.all: each card renders the
    // instant its own scenario lands rather than waiting on the slower one.
    for (const id of SUBDIVISION_SCENARIO_IDS) {
      solveSubdivisionScenario(target, id, headers)
        .then((result) => {
          if (runIdRef.current !== runId) return;
          setRuns((current) => ({
            ...current,
            [id]: result.solved
              ? { status: "done", scenario: result.scenario, cached: result.scenario.cached === true }
              : { status: "empty" },
          }));
          if (result.solved) {
            // First scenario home becomes the visible one, so the map fills in
            // as soon as there is anything to draw.
            setSelectedScenarioId((current) => current ?? id);
            setSolverVersion(result.solverVersion || null);
          }
        })
        .catch((err: unknown) => {
          if (runIdRef.current !== runId) return;
          const error =
            err instanceof SubdivisionError
              ? err
              : new SubdivisionError("Subdivision analysis failed", "UNKNOWN", true);
          setRuns((current) => ({
            ...current,
            [id]: { status: "failed", message: error.message, retryable: error.retryable },
          }));
        });
    }
  }, [canRequest, getApiHeaders, target]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setRuns(IDLE_RUNS);
    setHasStarted(false);
    setStartedAt(null);
    setElapsedSeconds(0);
    setSelectedScenarioId(null);
    setSolverVersion(null);
  }, []);

  const solvedScenarios = useMemo(
    () =>
      SUBDIVISION_SCENARIO_IDS.map((id) => runs[id])
        .filter((run): run is Extract<ScenarioRunState, { status: "done" }> => run.status === "done")
        .map((run) => run.scenario),
    [runs],
  );

  const siteResult = siteQuery.data;
  const siteError = siteQuery.error instanceof SubdivisionError ? siteQuery.error : null;

  return {
    available: canRequest && siteResult?.supported === true,
    siteLoading: canRequest && siteQuery.isLoading,
    siteResult,
    siteError,
    retrySite: () => void siteQuery.refetch(),
    runs,
    hasStarted,
    isSolving,
    elapsedSeconds,
    solvedScenarios,
    solverVersion,
    selectedScenarioId,
    selectScenario: setSelectedScenarioId,
    start,
    reset,
  };
}
