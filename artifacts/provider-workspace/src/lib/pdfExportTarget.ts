import type { FeasibilityReport } from "@/state/chat-model";

/**
 * Hand-off slot for "Export to PDF": the report view stashes the chosen report
 * here, then navigates to /report-pdf. Kept in-memory with a sessionStorage
 * fallback so a refresh on the editor page still finds the report.
 */
const KEY = "@alpha/ws-pdf-target";
let inMemory: FeasibilityReport | null = null;

export function setPdfExportTarget(report: FeasibilityReport): void {
  inMemory = report;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(report));
  } catch {
    /* quota — in-memory still works for this navigation */
  }
}

export function getPdfExportTarget(): FeasibilityReport | null {
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FeasibilityReport;
  } catch {
    /* ignore */
  }
  return null;
}
