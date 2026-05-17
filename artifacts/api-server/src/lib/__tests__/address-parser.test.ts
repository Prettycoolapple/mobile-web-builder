import { describe, expect, it } from "vitest";
import { extractNZAddress } from "../address-parser";

describe("NZ address extraction", () => {
  it("extracts a numbered NZ address from a Chinese analyse request", async () => {
    await expect(extractNZAddress("分析 66 marine parade mellons bay")).resolves.toBe(
      "66 marine parade mellons bay",
    );
  });

  it("preserves a valid parent address when a neighbouring child suffix exists", async () => {
    await expect(extractNZAddress("Analyse 8 Hampton Drive St Heliers")).resolves.toBe(
      "8 Hampton Drive St Heliers",
    );
  });
});
