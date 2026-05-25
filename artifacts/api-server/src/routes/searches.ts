import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, searches, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/searches", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const rows = await withDbRetry(() =>
      db
        .select({
          id: searches.id,
          address: searches.address,
          query: searches.query,
          resultJson: searches.resultJson,
          createdAt: searches.createdAt,
        })
        .from(searches)
        .where(eq(searches.userId, userId))
        .orderBy(desc(searches.createdAt))
        .limit(50),
    );

    const summary = rows
      .map((s) => {
        const rj = s.resultJson as any;
        if (!rj || typeof rj !== "object") return null;
        const isGroup = rj.kind === "combined_listing_group" && Array.isArray(rj.reports);
        const groupReports = isGroup ? rj.reports.filter((r: unknown) => r && typeof r === "object") : [];
        const groupScores = groupReports
          .map((r: any) => r.scores?.composite)
          .map((v: unknown) =>
            typeof v === "number"
              ? v
              : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))
                ? Number(v)
                : null,
          )
          .filter((v: number | null): v is number => v != null);
        const compositeRaw = isGroup
          ? (groupScores.length > 0 ? groupScores.reduce((sum: number, v: number) => sum + v, 0) / groupScores.length : null)
          : rj.scores?.composite;
        const composite =
          typeof compositeRaw === "number"
            ? compositeRaw
            : typeof compositeRaw === "string" && compositeRaw.trim() !== "" && !Number.isNaN(Number(compositeRaw))
              ? Number(compositeRaw)
              : null;
        const firstReport = groupReports[0] as any;
        return {
          id: s.id,
          address: isGroup
            ? `${rj.packageAddress ?? s.address ?? s.query} · ${groupReports.length}-property package`
            : s.address ?? s.query,
          created_at: s.createdAt,
          composite_score: composite,
          zone: (isGroup ? `${groupReports.length} reports` : (rj.propertyOverview?.zone ?? rj.planning?.zone ?? null)) as string | null,
          kind: isGroup ? "combined_listing_group" : "report",
          package_count: isGroup ? groupReports.length : undefined,
          package_address: isGroup ? rj.packageAddress ?? s.address ?? s.query : undefined,
          first_child_zone: isGroup ? (firstReport?.propertyOverview?.zone ?? firstReport?.planning?.zone ?? null) : undefined,
        };
      })
      .filter(Boolean);

    res.json({ searches: summary });
  } catch (error) {
    req.log.error({ err: error }, "Failed to get searches");
    res.status(500).json({ error: "Failed to get search history", code: "SEARCHES_FAILED" });
  }
});

router.get("/searches/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const [row] = await withDbRetry(() =>
      db
        .select()
        .from(searches)
        .where(and(eq(searches.id, id), eq(searches.userId, userId)))
        .limit(1),
    );

    if (!row) {
      res.status(404).json({ error: "Search not found", code: "NOT_FOUND" });
      return;
    }

    res.json({
      search: {
        id: row.id,
        user_id: row.userId,
        query: row.query,
        address: row.address,
        result_json: row.resultJson,
        created_at: row.createdAt,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to get search");
    res.status(500).json({ error: "Failed to get search", code: "GET_SEARCH_FAILED" });
  }
});

router.delete("/searches/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const deleted = await withDbRetry(() =>
      db
        .delete(searches)
        .where(and(eq(searches.id, id), eq(searches.userId, userId)))
        .returning({ id: searches.id }),
    );

    if (deleted.length === 0) {
      res.status(404).json({ error: "Search not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to delete search");
    res.status(500).json({ error: "Failed to delete search", code: "DELETE_FAILED" });
  }
});

export default router;
