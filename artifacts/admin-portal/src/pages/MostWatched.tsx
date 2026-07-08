import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface MostWatchedRow {
  propertyKey: string;
  address: string;
  listingUrl: string | null;
  priceDisplay: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  zone: string | null;
  compositeScore: number | null;
  watchCount: number;
  userCount: number;
  firstWatchedAt: string;
  lastWatchedAt: string;
}

interface MostWatchedResponse {
  total: number;
  limit: number;
  offset: number;
  rows: MostWatchedRow[];
}

interface WatchlistMonitorRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  targetsTotal: number;
  targetsChecked: number;
  changesDetected: number;
  notificationsSent: number;
  failures: number;
  lastError: string | null;
}

interface WatchlistMonitorStatus {
  latestRun: WatchlistMonitorRun | null;
  stateCount: number;
  dueCount: number;
  watchedCount: number;
}

const PAGE_SIZE = 50;

export default function MostWatchedPage() {
  const [data, setData] = useState<MostWatchedResponse | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<WatchlistMonitorStatus | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    apiGet<MostWatchedResponse>(`/admin/stats/most-watched?${params}`)
      .then(setData)
      .catch(() => setData(null));
  }, [offset]);

  useEffect(() => {
    apiGet<WatchlistMonitorStatus>("/admin/watchlist-monitor/status")
      .then(setMonitorStatus)
      .catch(() => setMonitorStatus(null));
  }, []);

  const latestRun = monitorStatus?.latestRun ?? null;

  return (
    <>
      <h1>Most watched</h1>
      <p className="subtitle">Properties saved to user watchlists, ranked from most saved to least saved.</p>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-header">
          <div className="panel-title">Watchlist monitor</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {latestRun ? `${latestRun.status} ${relativeTime(latestRun.finishedAt ?? latestRun.startedAt)}` : "No run yet"}
          </div>
        </div>

        {!monitorStatus ? (
          <div className="empty">Loading monitor status...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Metric label="Saved rows" value={monitorStatus.watchedCount.toLocaleString()} />
            <Metric label="Tracked addresses" value={monitorStatus.stateCount.toLocaleString()} />
            <Metric label="Due now" value={monitorStatus.dueCount.toLocaleString()} />
            <Metric
              label="Last checked"
              value={latestRun ? `${latestRun.targetsChecked.toLocaleString()} / ${latestRun.targetsTotal.toLocaleString()}` : "-"}
            />
            <Metric label="Changes" value={latestRun ? latestRun.changesDetected.toLocaleString() : "-"} />
            <Metric label="Push sent" value={latestRun ? latestRun.notificationsSent.toLocaleString() : "-"} />
            <Metric label="Failures" value={latestRun ? latestRun.failures.toLocaleString() : "-"} />
            <Metric
              label="Finished"
              value={latestRun?.finishedAt ? relativeTime(latestRun.finishedAt) : latestRun?.status === "running" ? "Running" : "-"}
              title={latestRun?.finishedAt ? formatDate(latestRun.finishedAt) : undefined}
            />
          </div>
        )}

        {latestRun?.lastError && (
          <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>
            Last error: {latestRun.lastError}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Watchlist ranking</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {data ? `${data.total.toLocaleString()} watched properties` : "Loading..."}
          </div>
        </div>

        {!data ? (
          <div className="empty">Loading...</div>
        ) : data.rows.length === 0 ? (
          <div className="empty">No watchlist saves yet.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Rank</th>
                    <th>Address</th>
                    <th style={{ width: 110, textAlign: "right" }}>Watches</th>
                    <th style={{ width: 110, textAlign: "right" }}>Users</th>
                    <th style={{ width: 130 }}>Price</th>
                    <th style={{ width: 120 }}>Type</th>
                    <th style={{ width: 90 }}>Beds/Baths</th>
                    <th style={{ width: 110 }}>Land</th>
                    <th style={{ width: 90, textAlign: "right" }}>Score</th>
                    <th style={{ width: 160 }}>Last saved</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.propertyKey}>
                      <td>{offset + i + 1}</td>
                      <td style={{ wordBreak: "break-word" }}>
                        <div style={{ fontWeight: 500 }}>{r.address}</div>
                        {r.zone && <div style={{ color: "var(--muted)", fontSize: 12 }}>{r.zone}</div>}
                        {r.listingUrl && (
                          <a
                            href={r.listingUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: "inline-block", marginTop: 4, color: "var(--accent, #2563eb)", fontSize: 12 }}
                          >
                            Open listing
                          </a>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {r.watchCount.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.userCount.toLocaleString()}
                      </td>
                      <td>{r.priceDisplay ?? "-"}</td>
                      <td>{r.propertyType ?? "-"}</td>
                      <td>{r.bedrooms ?? "-"} / {r.bathrooms ?? "-"}</td>
                      <td>{r.landAreaSqm != null ? `${r.landAreaSqm.toLocaleString()} sqm` : "-"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.compositeScore != null ? r.compositeScore.toFixed(0) : "-"}
                      </td>
                      <td title={formatDate(r.lastWatchedAt)}>
                        {relativeTime(r.lastWatchedAt)}
                        <div style={{ color: "var(--muted)", fontSize: 12 }} title={formatDate(r.firstWatchedAt)}>
                          first {relativeTime(r.firstWatchedAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.total > PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                <button
                  className="btn ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </button>
                <span style={{ color: "var(--muted)", fontSize: 13, alignSelf: "center" }}>
                  Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
                </span>
                <button
                  className="btn ghost"
                  disabled={offset + PAGE_SIZE >= data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
