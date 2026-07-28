import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { translateForOS } from "@/lib/i18n";
import { SUBDIVISION_SCENARIO_IDS, type SubdivisionScenarioId } from "@/lib/subdivision";
import type { ScenarioRunState, SubdivisionState } from "@/components/report/useSubdivision";

/**
 * The AI Subdivision results panel: live progress while the solvers run, then a
 * card per scenario that the user taps to switch which one the map draws.
 *
 * Progress is reported as an elapsed-seconds counter rather than a bare spinner.
 * The solver gives no completion signal to interpolate, so a percentage bar
 * would be fiction; an honest counter plus per-scenario state is what tells a
 * user the app is still working during a cold solve that can run for minutes.
 */

const SCENARIO_LABEL_KEYS: Record<SubdivisionScenarioId, string> = {
  "max-yield": "site_plan.subdivision.max_yield",
  "high-end": "site_plan.subdivision.high_end",
};

/** Mirrors SubdivisionOverlay's colours so the legend matches the drawing. */
const LOT_COLOR = "#7C3AED";
const FOOTPRINT_COLOR = "#FB923C";

function totalFootprintM2(run: Extract<ScenarioRunState, { status: "done" }>): number {
  return run.scenario.lots.reduce((sum, lot) => sum + (lot.footprintM2 || 0), 0);
}

function ScenarioCard({
  id,
  run,
  selected,
  onSelect,
}: {
  id: SubdivisionScenarioId;
  run: ScenarioRunState;
  selected: boolean;
  onSelect: () => void;
}) {
  const colors = useColors();
  const title = translateForOS(SCENARIO_LABEL_KEYS[id]);
  const selectable = run.status === "done";

  return (
    <TouchableOpacity
      style={[
        styles.scenarioCard,
        {
          backgroundColor: selected ? `${LOT_COLOR}12` : colors.card,
          borderColor: selected ? LOT_COLOR : colors.border,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
      activeOpacity={selectable ? 0.75 : 1}
      disabled={!selectable}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !selectable }}
      accessibilityLabel={title}
    >
      {/* Only the selection tick shares this row. Two cards sit side by side on a
          ~375 pt screen, so anything else here truncates the scenario name. */}
      <View style={styles.scenarioHeader}>
        <Text style={[styles.scenarioTitle, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        {selected ? <Feather name="check-circle" size={16} color={LOT_COLOR} /> : null}
      </View>

      {run.status === "running" ? (
        <View style={styles.scenarioRow}>
          <ActivityIndicator size="small" color={LOT_COLOR} />
          <Text style={[styles.scenarioMeta, { color: colors.mutedForeground }]}>
            {translateForOS("site_plan.subdivision.scenario_running")}
          </Text>
        </View>
      ) : null}

      {run.status === "done" ? (
        <>
          <Text style={[styles.scenarioLots, { color: LOT_COLOR }]}>{run.scenario.label}</Text>
          {run.cached ? (
            <View style={[styles.instantPill, { backgroundColor: `${colors.success}1A` }]}>
              <Feather name="zap" size={10} color={colors.success} />
              <Text style={[styles.instantText, { color: colors.success }]}>
                {translateForOS("site_plan.subdivision.instant")}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.scenarioMeta, { color: colors.mutedForeground }]}>
            {translateForOS("site_plan.subdivision.building_total", {
              area: totalFootprintM2(run),
            })}
          </Text>
          {run.scenario.drivewayAreaM2 > 0 ? (
            <Text style={[styles.scenarioMeta, { color: colors.mutedForeground }]}>
              {translateForOS("site_plan.subdivision.driveway", {
                area: run.scenario.drivewayAreaM2,
              })}
            </Text>
          ) : null}
        </>
      ) : null}

      {run.status === "empty" ? (
        <Text style={[styles.scenarioMeta, { color: colors.mutedForeground }]}>
          {translateForOS("site_plan.subdivision.no_layout")}
        </Text>
      ) : null}

      {run.status === "failed" ? (
        <Text style={[styles.scenarioMeta, { color: colors.destructive }]}>
          {translateForOS("site_plan.subdivision.failed")}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export function SubdivisionPanel({
  state,
  solverVersion,
}: {
  state: SubdivisionState;
  solverVersion: string | null;
}) {
  const colors = useColors();
  if (!state.hasStarted) return null;

  const anyFailed = SUBDIVISION_SCENARIO_IDS.some((id) => state.runs[id].status === "failed");
  const anyRetryable = SUBDIVISION_SCENARIO_IDS.some(
    (id) => state.runs[id].status === "failed" && (state.runs[id] as { retryable?: boolean }).retryable,
  );

  return (
    <View style={[styles.panel, { borderTopColor: colors.border }]}>
      {state.isSolving ? (
        <View style={[styles.progress, { backgroundColor: colors.muted }]}>
          <ActivityIndicator size="small" color={LOT_COLOR} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.progressTitle, { color: colors.foreground }]}>
              {translateForOS("site_plan.subdivision.analysing")}
            </Text>
            <Text style={[styles.progressNote, { color: colors.mutedForeground }]}>
              {translateForOS("site_plan.subdivision.analysing_note", {
                seconds: state.elapsedSeconds,
              })}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.scenarioRowWrap}>
        {SUBDIVISION_SCENARIO_IDS.map((id) => (
          <ScenarioCard
            key={id}
            id={id}
            run={state.runs[id]}
            selected={state.selectedScenarioId === id}
            onSelect={() => state.selectScenario(id)}
          />
        ))}
      </View>

      {state.solvedScenarios.length > 0 ? (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { borderColor: LOT_COLOR, backgroundColor: `${LOT_COLOR}33` }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
              {translateForOS("site_plan.subdivision.legend_lot")}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { borderColor: "#C2410C", backgroundColor: FOOTPRINT_COLOR }]}
            />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
              {translateForOS("site_plan.subdivision.legend_footprint")}
            </Text>
          </View>
        </View>
      ) : null}

      {anyFailed && !state.isSolving && anyRetryable ? (
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.foreground }]}
          onPress={state.start}
          activeOpacity={0.85}
        >
          <Text style={[styles.retryText, { color: colors.card }]}>
            {translateForOS("site_plan.subdivision.retry")}
          </Text>
        </TouchableOpacity>
      ) : null}

      {state.solvedScenarios.length > 0 ? (
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          {translateForOS("site_plan.subdivision.indicative")}
          {solverVersion
            ? ` ${translateForOS("site_plan.subdivision.solver_version", { version: solverVersion })}`
            : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 10,
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  progressTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 13,
    lineHeight: 18,
  },
  progressNote: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  scenarioRowWrap: {
    flexDirection: "row",
    gap: 9,
  },
  scenarioCard: {
    flex: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 4,
    minHeight: 96,
  },
  scenarioHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scenarioTitle: {
    flex: 1,
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
    lineHeight: 16,
  },
  scenarioLots: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 19,
    lineHeight: 25,
  },
  scenarioMeta: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    lineHeight: 15,
  },
  scenarioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 6,
  },
  instantPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 1,
  },
  instantText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 9,
    lineHeight: 13,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendSwatch: {
    width: 20,
    height: 14,
    borderRadius: 3,
    borderWidth: 2,
  },
  legendText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    lineHeight: 15,
  },
  retryButton: {
    alignSelf: "flex-start",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  retryText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
  },
  footnote: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 10,
    lineHeight: 14,
  },
});
