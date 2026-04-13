import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, searches } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/searches", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const rows = await db
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
      .limit(50);

    const summary = rows
      .map((s) => {
        const rj = s.resultJson as any;
        const hasScores = rj && typeof rj === "object" && rj.scores && typeof rj.scores.composite === "number";
        if (!hasScores) return null;
        return {
          id: s.id,
          address: s.address ?? s.query,
          created_at: s.createdAt,
          composite_score: rj.scores.composite as number,
          zone: (rj.propertyOverview?.zone ?? rj.planning?.zone ?? null) as string | null,
        };
      })
      .filter(Boolean);

    res.json({ searches: summary });
  } catch (error) {
    req.log.error({ error }, "Failed to get searches");
    res.status(500).json({ error: "Failed to get search history", code: "SEARCHES_FAILED" });
  }
});

router.get("/searches/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const [row] = await db
      .select()
      .from(searches)
      .where(and(eq(searches.id, id), eq(searches.userId, userId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Search not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ search: row });
  } catch (error) {
    req.log.error({ error }, "Failed to get search");
    res.status(500).json({ error: "Failed to get search", code: "GET_SEARCH_FAILED" });
  }
});

router.delete("/searches/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const deleted = await db
      .delete(searches)
      .where(and(eq(searches.id, id), eq(searches.userId, userId)))
      .returning({ id: searches.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Search not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "Failed to delete search");
    res.status(500).json({ error: "Failed to delete search", code: "DELETE_FAILED" });
  }
});

export default router;
