import type { FeasibilityReport } from "@/context/ChatContext";
import { getApiBase } from "@/lib/api";

/** Server normalises all narrative strings to zh (idempotent via ensureChinese). */
export async function translateReportViaApi(
  report: FeasibilityReport,
  headers: Record<string, string>,
): Promise<FeasibilityReport | null> {
  try {
    const base = getApiBase();
    const resp = await fetch(`${base}/translate-report`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { report?: FeasibilityReport };
    return data.report ?? null;
  } catch {
    return null;
  }
}
