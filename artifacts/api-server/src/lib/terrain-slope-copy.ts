import type { Locale } from "./prompts";

export type TerrainContour = "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep";

function degPhrase(slopeDegrees: number | null | undefined, locale: Locale): string {
  if (typeof slopeDegrees !== "number") return "";
  return locale === "zh" ? `（~${slopeDegrees} 度）` : ` (~${slopeDegrees} degrees)`;
}

/** Deterministic terrain slope narrative (Contour & terrain section). */
export function terrainSlopeText(
  contour: TerrainContour | null | undefined,
  slopeDegrees: number | null | undefined,
  locale: Locale,
): string | null {
  if (!contour) return null;
  const deg = degPhrase(slopeDegrees, locale);

  if (locale === "zh") {
    if (contour === "flat") {
      return `平坦地形${deg} - 几乎完全平整，通常适合标准建造和日常行走。`;
    }
    if (contour === "subtle" || contour === "gentle") {
      return `缓坡${deg} - 坡度舒适，通常容易行走、维护和施工，只需小幅场地整理。`;
    }
    if (contour === "moderate") {
      return `中坡${deg} - 坡度已明显可感，通常需要少量土方、台地或挡土设计确认。`;
    }
    if (contour === "steep") {
      return `陡坡${deg} - 行走体感很陡，建筑布局可能需要错层、挡土及岩土工程设计。`;
    }
    return `极陡地形${deg} - 属于高成本地形，地基、挡土和岩土工程风险显著，需专业复核。`;
  }

  if (contour === "flat") {
    return `Flat terrain${deg} - effectively level; suitable for standard building and easy walking.`;
  }
  if (contour === "subtle" || contour === "gentle") {
    return `Subtle slope${deg} - a comfortable incline; usually easy to walk, maintain, and construct on.`;
  }
  if (contour === "moderate") {
    return `Moderate slope${deg} - distinctly sloping; allow for minor earthworks, benching, and survey confirmation.`;
  }
  if (contour === "steep") {
    return `Steep terrain${deg} - feels very steep to walk; split-level design, retaining, and geotechnical input are likely.`;
  }
  return `Very steep terrain${deg} - severe terrain with extreme foundation, retaining, and engineering cost risk.`;
}
