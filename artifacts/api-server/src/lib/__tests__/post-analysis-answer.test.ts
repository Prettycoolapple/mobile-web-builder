import { describe, expect, it } from "vitest";
import { buildDevScoreNotice, buildPostAnalysisAnswer, buildPostAnalysisAnswers, detectPostAnalysisIntent, detectPostAnalysisIntents } from "../post-analysis-answer";

describe("post-analysis attached question detection", () => {
  it("detects rental ownership cost questions attached to an analyse prompt", () => {
    expect(
      detectPostAnalysisIntent("1/289 Ulster Street, Whitiora. What would the expected costs be to own this property as a rental."),
    ).toBe("rental_ownership_costs");
  });

  it("detects multiple attached questions in order", () => {
    expect(
      detectPostAnalysisIntents("1/289 Ulster Street, Whitiora. What would the expected costs be to own this property as a rental. What is the estimated market value of this property"),
    ).toEqual(["rental_ownership_costs", "market_value_estimate"]);
  });

  it("detects 'cost of owning ... as a rental property' phrasing plus market value", () => {
    expect(
      detectPostAnalysisIntents("What is the cost of owning 44 Grampian road st Heliers as a rental property and what is the market value estimate for this property?"),
    ).toEqual(["rental_ownership_costs", "market_value_estimate"]);
  });

  it("detects Chinese rental holding-cost questions", () => {
    expect(
      detectPostAnalysisIntent("如果把奥克兰这套房子出租，持有成本大概是多少？"),
    ).toBe("rental_ownership_costs");
  });

  it("ignores unrelated analysis prompts", () => {
    expect(detectPostAnalysisIntent("Analyse 1/289 Ulster Street, Whitiora")).toBeNull();
  });
});

describe("post-analysis rental cost answer", () => {
  it("uses listing price ahead of CV", () => {
    const answer = buildPostAnalysisAnswer(
      "What would this cost to own as a rental?",
      {
        property_overview_snapshot: {
          listing_price_nzd: 720_000,
          cv_nzd: 650_000,
        },
      },
      "en",
    );

    expect(answer).toContain("$720,000");
    expect(answer).toContain("$10,800");
    expect(answer).toContain("$40,320/year");
  });

  it("falls back to CV when no listing price is present", () => {
    const answer = buildPostAnalysisAnswer(
      "expected costs to own this investment property",
      {
        propertyOverview: {
          cv: "$650,000",
        },
      },
      "en",
    );

    expect(answer).toContain("$650,000");
    expect(answer).toContain("CV");
  });
});

describe("post-analysis market value answer", () => {
  it("returns a separate rental answer and market value answer when both are asked", () => {
    const answers = buildPostAnalysisAnswers(
      "1/289 Ulster Street, Whitiora. What would the expected costs be to own this property as a rental. What is the estimated market value of this property",
      {
        property_overview_snapshot: {
          listing_price_nzd: 720_000,
          cv_nzd: 650_000,
        },
        scores: { ease: 3, cost: 3, roi: 3, composite: 3 },
      },
      "en",
    );

    expect(answers).toHaveLength(2);
    expect(answers[0]).toContain("Rental ownership cost");
    expect(answers[0]).toContain("$720,000");
    expect(answers[1]).toContain("Estimated market value");
    expect(answers[1]).toContain("$720,000");
    expect(answers[1]).not.toContain("cv_nzd");
  });

  it("uses CV for market value when no listing price is available without exposing code fields", () => {
    const answer = buildPostAnalysisAnswer(
      "What is the estimated market value of this property?",
      { propertyOverview: { cv: "$650,000" }, scores: { ease: 3, cost: 3, roi: 3, composite: 3 } },
      "en",
    );

    expect(answer).toContain("Estimated market value");
    expect(answer).toContain("$650,000");
    expect(answer).toContain("CV");
    expect(answer).not.toContain("cv_nzd");
  });
});

describe("post-analysis subdivision lot-count answer", () => {
  it("detects a lot-count subdivision ask even when phrased as 'N lot subdivision'", () => {
    // Regression for the exact bug report: this phrase was previously mis-split
    // into two addresses by the combined-listing detector (see
    // realestate-api.test.ts) instead of being read as one address plus a
    // 3-lot subdivision intent.
    expect(
      detectPostAnalysisIntent("Create a feasibility for a 3 lot subdivision at 13 Campbell place papakura"),
    ).toBe("subdivision_lot_feasibility");
  });

  it("ignores plain analyse requests with no subdivision word", () => {
    expect(detectPostAnalysisIntent("Analyse 13 Campbell Place, Papakura")).toBeNull();
  });

  it("summarises risks and returns when the report models a matching lot count", () => {
    const answer = buildPostAnalysisAnswer(
      "Create a feasibility for a 3 lot subdivision at 13 Campbell place papakura",
      {
        potential_lots: 3,
        scores: { ease: 3.5, cost: 3.0, roi: 4.0, composite: 3.6 },
        roiScenarios: [
          { years: 4, roi_percent: 22, gdv: 2_100_000 },
          { years: 6, roi_percent: 36, gdv: 2_400_000 },
        ],
        riskSummary: ["Mixed Housing Urban zone allows the ask, but overlays should be re-checked before design."],
      },
      "en",
    );

    expect(answer).toContain("3 potential lots");
    expect(answer).toContain("matching the 3-lot subdivision");
    expect(answer).toContain("Feasibility 3.5/5, cost 3/5, return 4/5");
    expect(answer).toContain("36% ROI over about 6 years");
    expect(answer).toContain("Key risk to weigh: Mixed Housing Urban zone allows the ask");
  });

  it("flags when the report models fewer lots than asked", () => {
    const answer = buildPostAnalysisAnswer(
      "subdivide into 5 lots at 20 Test Street",
      { potential_lots: 2, scores: { ease: 3, cost: 3, roi: 3 } },
      "en",
    );

    expect(answer).toContain("only models 2 potential lots");
    expect(answer).toContain("fewer than the 5");
  });

  it("returns a data-unavailable message when the report has no lot or score data", () => {
    const answer = buildPostAnalysisAnswer(
      "3 lot subdivision at 5 Test Road",
      { propertyOverview: { address: "5 Test Road" } },
      "en",
    );

    expect(answer).toContain("doesn't have enough lot/planning data yet");
  });

  it("responds in Chinese when the locale is zh", () => {
    const answer = buildPostAnalysisAnswer(
      "3 lot subdivision at 5 Test Road",
      { potential_lots: 3, scores: { ease: 3, cost: 3, roi: 3, composite: 3 } },
      "zh",
    );

    expect(answer).toContain("与你询问的 3 块一致");
  });
});

describe("no-development-score specialist notice", () => {
  it("returns the notice when the report has a score_unavailable_reason (no score)", () => {
    const notice = buildDevScoreNotice({ score_unavailable_reason: "missing_land_area_sqm", scores: null }, "en");
    expect(notice).toContain("doesn't have a development score");
    expect(notice).toContain("specialist consultant");
  });

  it("returns the notice when the scores object itself is null", () => {
    expect(buildDevScoreNotice({ scores: null }, "en")).not.toBeNull();
  });

  it("returns a Chinese notice when the locale is zh", () => {
    const notice = buildDevScoreNotice({ score_unavailable_reason: "unit_or_crosslease_signal" }, "zh");
    expect(notice).toContain("暂无开发评分");
    expect(notice).toContain("专业开发顾问");
  });

  it("returns null when the report has a real composite score", () => {
    expect(
      buildDevScoreNotice({ score_unavailable_reason: null, scores: { ease: 4, cost: 3, roi: 4, composite: 3.7 } }, "en"),
    ).toBeNull();
  });

  it("buildPostAnalysisAnswer appends the notice after a report with no score", () => {
    // A plain analyse (no rental/subdivision intent) on a score-suppressed report
    // still yields the specialist notice as the appended bubble.
    const answer = buildPostAnalysisAnswer(
      "Analyse 7 Sultan Street, Ellerslie",
      { score_unavailable_reason: "missing_land_area_sqm", scores: null },
      "en",
    );
    expect(answer).toContain("specialist consultant");
  });

  it("buildPostAnalysisAnswer joins an intent answer AND the notice when both apply", () => {
    const answer = buildPostAnalysisAnswer(
      "What would this cost to own as a rental?",
      {
        score_unavailable_reason: "missing_cv_nzd",
        scores: null,
        property_overview_snapshot: { listing_price_nzd: 720_000 },
      },
      "en",
    );
    // Intent answer (rental cost) …
    expect(answer).toContain("$720,000");
    // … followed by the no-score notice.
    expect(answer).toContain("specialist consultant");
  });

  it("buildPostAnalysisAnswer returns null for a fully-scored report with no intent", () => {
    expect(
      buildPostAnalysisAnswer(
        "Analyse 12 Example Road",
        { score_unavailable_reason: null, scores: { ease: 4, cost: 3, roi: 4, composite: 3.7 } },
        "en",
      ),
    ).toBeNull();
  });
});
