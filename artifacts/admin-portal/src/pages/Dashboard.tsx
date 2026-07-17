import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import { formatBucketLabel, formatPercent } from "@/lib/format";
import CohortTriangle from "@/components/CohortTriangle";

type Bucket = "week" | "month";

interface SignupBucket {
  bucketStart: string;
  count: number;
  byRole: { general: number; sales_agent: number; service_provider: number };
}

interface ConversionBucket {
  bucketStart: string;
  signups: number;
  paidNow: number;
  conversionRate: number;
}

interface CohortRow {
  cohortWeek: string;
  size: number;
  retainedByWeekOffset: number[];
}

interface GlobalCounts {
  totalReports: number;
  totalAgentCalls: number;
  totalAiSubdivisionInterest: number;
  totalAiSubdivisionCompletions: number;
  aiSubdivisionCompletionRate: number;
  generalFreeAiSubdivisionInterest: number;
  generalFreeAiSubdivisionCompletions: number;
  generalFreeAiSubdivisionCompletionRate: number;
  callsPerReport: number;
}

interface TopAddressRow {
  address: string;
  count: number;
}

interface TopAddressesResponse {
  total: number;
  limit: number;
  offset: number;
  rows: TopAddressRow[];
}

const TOP_ADDR_PAGE_SIZE = 10;

export default function DashboardPage() {
  const [signupBucket, setSignupBucket] = useState<Bucket>("week");
  const [conversionBucket, setConversionBucket] = useState<Bucket>("week");
  const [signups, setSignups] = useState<SignupBucket[]>([]);
  const [conversion, setConversion] = useState<ConversionBucket[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [cohortWeeks, setCohortWeeks] = useState(8);
  const [loading, setLoading] = useState(true);
  const [globalCounts, setGlobalCounts] = useState<GlobalCounts | null>(null);
  const [topAddresses, setTopAddresses] = useState<TopAddressesResponse | null>(null);
  const [topAddrOffset, setTopAddrOffset] = useState(0);

  useEffect(() => {
    apiGet<{ buckets: SignupBucket[] }>(`/admin/stats/signups?bucket=${signupBucket}`)
      .then((d) => setSignups(d.buckets))
      .catch(() => setSignups([]));
  }, [signupBucket]);

  useEffect(() => {
    apiGet<{ buckets: ConversionBucket[] }>(
      `/admin/stats/conversion?bucket=${conversionBucket}`,
    )
      .then((d) => setConversion(d.buckets))
      .catch(() => setConversion([]));
  }, [conversionBucket]);

  useEffect(() => {
    apiGet<GlobalCounts>("/admin/stats/global-counts")
      .then(setGlobalCounts)
      .catch(() => setGlobalCounts(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      limit: String(TOP_ADDR_PAGE_SIZE),
      offset: String(topAddrOffset),
    });
    apiGet<TopAddressesResponse>(`/admin/stats/top-addresses?${params}`)
      .then(setTopAddresses)
      .catch(() => setTopAddresses(null));
  }, [topAddrOffset]);

  useEffect(() => {
    setLoading(true);
    apiGet<{ weeks: number; cohorts: CohortRow[] }>(
      `/admin/stats/retention/cohorts?weeks=${cohortWeeks}`,
    )
      .then((d) => {
        setCohorts(d.cohorts);
        setCohortWeeks(d.weeks);
      })
      .catch(() => setCohorts([]))
      .finally(() => setLoading(false));
  }, [cohortWeeks]);

  const signupChartData = signups.map((b) => ({
    label: formatBucketLabel(b.bucketStart, signupBucket),
    general: b.byRole.general,
    sales_agent: b.byRole.sales_agent,
    service_provider: b.byRole.service_provider,
  }));

  const conversionChartData = conversion.map((b) => ({
    label: formatBucketLabel(b.bucketStart, conversionBucket),
    signups: b.signups,
    paidNow: b.paidNow,
    rate: Math.round(b.conversionRate * 1000) / 10,
  }));

  return (
    <>
      <h1>Dashboard</h1>
      <p className="subtitle">Signup growth, free → paid conversion, and weekly cohort retention.</p>

      <div className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Signup growth rate</div>
            <BucketToggle value={signupBucket} onChange={setSignupBucket} />
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signupChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="general" stackId="a" fill="#5a564f" name="General" />
                <Bar dataKey="sales_agent" stackId="a" fill="#2f4d8e" name="Sales agent" />
                <Bar dataKey="service_provider" stackId="a" fill="#ff6f4f" name="Service provider" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Conversion rate</div>
            <BucketToggle value={conversionBucket} onChange={setConversionBucket} />
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={conversionChartData}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "rate" ? [`${value}%`, "Conversion"] : [value, name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="signups"
                  stroke="#5a564f"
                  strokeWidth={2}
                  name="Signups"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="paidNow"
                  stroke="#2f9e6b"
                  strokeWidth={2}
                  name="On paid plan"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rate"
                  stroke="#ff6f4f"
                  strokeWidth={2}
                  name="Conversion %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel full">
          <div className="panel-header">
            <div className="panel-title">Cohort retention</div>
            <div className="toggle">
              {[4, 8, 12].map((w) => (
                <button
                  key={w}
                  className={cohortWeeks === w ? "active" : ""}
                  onClick={() => setCohortWeeks(w)}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="empty">Loading…</div>
          ) : (
            <CohortTriangle cohorts={cohorts} weeks={cohortWeeks} />
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
            Each row groups users by signup week. Cells show the % of that cohort who logged in during week N
            after signup. Older cohorts won't have data before this feature shipped.{" "}
            <span style={{ fontWeight: 600 }}>{formatPercent(cohorts[0]?.retainedByWeekOffset[1] ?? 0)}</span>{" "}
            example W1 rate.
          </p>
        </div>

        <div className="panel full">
          <div className="panel-header">
            <div className="panel-title">Global activity</div>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Feasibility reports generated
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {globalCounts ? globalCounts.totalReports.toLocaleString() : "—"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Agent calls placed
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {globalCounts ? globalCounts.totalAgentCalls.toLocaleString() : "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Recommended-card calls only</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                AI subdivision funnel
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {globalCounts ? globalCounts.totalAiSubdivisionInterest.toLocaleString() : "â€”"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {globalCounts
                  ? `${globalCounts.totalAiSubdivisionCompletions.toLocaleString()} final OKs · ${(globalCounts.aiSubdivisionCompletionRate * 100).toFixed(1)}% completion`
                  : "New-popup taps, final OKs, and completion"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 250 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                General free-tier funnel
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {globalCounts ? globalCounts.generalFreeAiSubdivisionInterest.toLocaleString() : "â€”"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {globalCounts
                  ? `${globalCounts.generalFreeAiSubdivisionCompletions.toLocaleString()} final OKs · ${(globalCounts.generalFreeAiSubdivisionCompletionRate * 100).toFixed(1)}% completion`
                  : "Free general-user taps and final OKs"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Ratio (calls per report)
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {globalCounts ? globalCounts.callsPerReport.toFixed(2) : "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Higher = stronger analyse→call funnel</div>
            </div>
          </div>
        </div>

        <div className="panel full">
          <div className="panel-header">
            <div className="panel-title">Most-analyzed addresses</div>
            {topAddresses && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                Showing {topAddresses.total === 0 ? 0 : topAddrOffset + 1}–
                {Math.min(topAddrOffset + TOP_ADDR_PAGE_SIZE, topAddresses.total)} of {topAddresses.total}
              </div>
            )}
          </div>
          {!topAddresses ? (
            <div className="empty">Loading…</div>
          ) : topAddresses.rows.length === 0 ? (
            <div className="empty">No analyses yet.</div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Rank</th>
                      <th>Address</th>
                      <th style={{ width: 100, textAlign: "right" }}>Analyses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAddresses.rows.map((r, i) => (
                      <tr key={`${r.address}-${i}`}>
                        <td>{topAddrOffset + i + 1}</td>
                        <td style={{ wordBreak: "break-word" }}>{r.address}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {topAddresses.total > TOP_ADDR_PAGE_SIZE && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                  <button
                    className="btn ghost"
                    disabled={topAddrOffset === 0}
                    onClick={() => setTopAddrOffset(Math.max(0, topAddrOffset - TOP_ADDR_PAGE_SIZE))}
                  >
                    ← Previous
                  </button>
                  <button
                    className="btn ghost"
                    disabled={topAddrOffset + TOP_ADDR_PAGE_SIZE >= topAddresses.total}
                    onClick={() => setTopAddrOffset(topAddrOffset + TOP_ADDR_PAGE_SIZE)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function BucketToggle({
  value,
  onChange,
}: {
  value: Bucket;
  onChange: (b: Bucket) => void;
}) {
  return (
    <div className="toggle">
      <button className={value === "week" ? "active" : ""} onClick={() => onChange("week")}>
        Week
      </button>
      <button className={value === "month" ? "active" : ""} onClick={() => onChange("month")}>
        Month
      </button>
    </div>
  );
}
