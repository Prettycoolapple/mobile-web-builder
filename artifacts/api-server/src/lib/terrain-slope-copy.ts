import type { Locale } from "./prompts";

export type TerrainContour = "flat" | "gentle" | "moderate" | "steep";

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
      return `平坦地形${deg} - 根据等高线数据，预计无需进行明显的挡土工程。`;
    }
    if (contour === "gentle") {
      return `缓坡${deg} - 仅需小幅平整；正式设计前仍需进行现场专项测量。`;
    }
    if (contour === "moderate") {
      return `中坡${deg} - 需考虑台地、挡土及岩土勘察确认。`;
    }
    return `陡坡${deg} - 可能需要大量挡土及岩土工程设计。`;
  }
  if (contour === "flat") {
    return `Flat terrain${deg} - no meaningful retaining expected from contour data.`;
  }
  if (contour === "gentle") {
    return `Gentle slope${deg} - minor level changes only; standard site-specific survey still required before design.`;
  }
  if (contour === "moderate") {
    return `Moderate slope${deg} - allow for benching, retaining, and geotechnical confirmation.`;
  }
  return `Steep terrain${deg} - significant retaining and geotechnical design likely required.`;
}
