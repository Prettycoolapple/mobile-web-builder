import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface CacheRow {
  id: string;
  addressKey: string;
  formattedAddress: string | null;
  suburb: string | null;
  canonicalParcelId: string | null;
  pipelineVersion: number;
  hitCount: number;
  refreshCount: number;
  firstAnalysedAt: string;
  lastRefreshedAt: string;
  sourceUserId: string | null;
}

interface CacheResponse {
  total: number;
  limit: number;
  offset: number;
  rows: CacheRow[];
}

interface RescanStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  updated: number;
  failed: number;
  lastError: string | null;
}

const PAGE_SIZE = 50;

function staleness(lastRefreshedAt: string): { label: string; className: string } {
  const days = (Date.now() - new Date(lastRefreshedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 30) return { label: "Fresh", className: "badge fresh" };
  if (days < 90) return { label: "Aging", className: "badge aging" };
  return { label: "Stale", className: "badge stale" };
}

export default function PropertyCachePage() {
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Rescan state
  const [rescanStatus, setRescanStatus] = useState<RescanStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load rows
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search) params.set("search", search);
    apiGet<CacheResponse>(`/admin/property-cache?${params}`)
      .then((d) => { setRows(d.rows); setTotal(d.total); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [search, offset]);

  // Poll rescan status while running
  useEffect(() => {
    function poll() {
      apiGet<RescanStatus>("/admin/property-cache/rescan/status")
        .then(setRescanStatus)
        .catch(() => {});
    }
    poll();
  }, []);

  useEffect(() => {
    if (rescanStatus?.running) {
      pollRef.current = setInterval(() => {
        apiGet<RescanStatus>("/admin/property-cache/rescan/status")
          .then(setRescanStatus)
          .catch(() => {});
      }, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [rescanStatus?.running]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  async function startRescan() {
    setStarting(true);
    try {
      await apiPost("/admin/property-cache/rescan", { concurrency: 2, maxRows: 500 });
      const status = await apiGet<RescanStatus>("/admin/property-cache/rescan/status");
      setRescanStatus(status);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start rescan");
    } finally {
      setStarting(false);
      setConfirmOpen(false);
    }
  }

  const isRunning = rescanStatus?.running === true;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1>Property feasibility reports</h1>
          <p className="subtitle">
            Global cache of raw property data — one row per unique address ever analysed by any user.
            Derived numbers (costs, ROI, scores) are recomputed fresh on every serve; only the
            external acquisition layer (LINZ, GIS, scrapers) is cached here.
          </p>
        </div>
        <button
          className="btn primary"
          style={{ marginTop: 8, whiteSpace: "nowrap" }}
          onClick={() => setConfirmOpen(true)}
          disabled={isRunning}
        >
          {isRunning ? "Rescan running…" : "Rescan all"}
        </button>
      </div>

      {/* Rescan status bar */}
      {rescanStatus && (rescanStatus.running || rescanStatus.finishedAt) && (
        <div
          className="panel"
          style={{
            marginBottom: 20,
            padding: "14px 20px",
            background: rescanStatus.running ? "rgba(214, 132, 35, 0.07)" : "rgba(47, 158, 107, 0.07)",
            borderColor: rescanStatus.running ? "var(--amber)" : "var(--green)",
          }}
        >
          {rescanStatus.running ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--amber)" }}>⟳ Rescan in progress</span>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                {rescanStatus.processed} / {rescanStatus.total} processed
                &nbsp;·&nbsp; {rescanStatus.updated} updated
                &nbsp;·&nbsp; {rescanStatus.failed} failed
              </span>
              <div style={{ flex: 1, minWidth: 120, background: "var(--line)", borderRadius: 4, height: 6 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 4,
                    background: "var(--amber)",
                    width: rescanStatus.total > 0
                      ? `${Math.round((rescanStatus.processed / rescanStatus.total) * 100)}%`
                      : "0%",
                    transition: "width 0.4s",
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 600, color: "var(--green)" }}>✓ Last rescan complete</span>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Finished {relativeTime(rescanStatus.finishedAt!)}
                &nbsp;·&nbsp; {rescanStatus.updated} updated
                &nbsp;·&nbsp; {rescanStatus.failed} failed
                {rescanStatus.lastError && (
                  <span style={{ color: "var(--coral)", marginLeft: 8 }}>Last error: {rescanStatus.lastError}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <form onSubmit={onSearchSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              className="search"
              placeholder="Search address…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn ghost">Search</button>
          </form>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{total.toLocaleString()} cached</div>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No cached addresses{search ? " matching your search" : ""}.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Suburb</th>
                  <th>Parcel ID</th>
                  <th>Freshness</th>
                  <th>Last refreshed</th>
                  <th>First analysed</th>
                  <th style={{ textAlign: "right" }}>Hits</th>
                  <th style={{ textAlign: "right" }}>Rescans</th>
                  <th style={{ textAlign: "right" }}>Version</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { label, className } = staleness(r.lastRefreshedAt);
                  return (
                    <tr key={r.id}>
                      <td style={{ maxWidth: 300 }}>
                        <span title={r.addressKey} style={{ fontWeight: 500 }}>
                          {r.formattedAddress ?? r.addressKey}
                        </span>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{r.suburb ?? "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                        {r.canonicalParcelId ?? "—"}
                      </td>
                      <td><span className={className}>{label}</span></td>
                      <td title={formatDate(r.lastRefreshedAt)}>{relativeTime(r.lastRefreshedAt)}</td>
                      <td title={formatDate(r.firstAnalysedAt)}>{relativeTime(r.firstAnalysedAt)}</td>
                      <td style={{ textAlign: "right" }}>{r.hitCount.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{r.refreshCount.toLocaleString()}</td>
                      <td style={{ textAlign: "right", color: "var(--muted)" }}>v{r.pipelineVersion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button
              className="btn ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              ← Previous
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13, alignSelf: "center" }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <button
              className="btn ghost"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}
        >
          <div
            className="panel"
            style={{ width: "min(480px, 90vw)", padding: 32, margin: 0 }}
          >
            <h2 style={{ marginTop: 0, fontSize: 20 }}>Rescan all cached properties?</h2>
            <p style={{ color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 24 }}>
              This will re-run the full live pipeline (LINZ, Auckland Council GIS, all scrapers)
              for every stored address — up to <strong>500 at a time</strong>, 2 at a time in parallel.
              Only entries where ScrapingBee returns data will be updated; failures are skipped so
              existing cached data is never overwritten with empty results.
            </p>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 28 }}>
              The rescan runs in the background and can take a long time for large datasets.
              You can safely close this page — progress is visible the next time you return.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setConfirmOpen(false)} disabled={starting}>
                Cancel
              </button>
              <button className="btn primary" onClick={startRescan} disabled={starting}>
                {starting ? "Starting…" : "Yes, start rescan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
