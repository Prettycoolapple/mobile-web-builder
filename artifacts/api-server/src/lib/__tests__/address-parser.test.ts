import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

import { ai } from "@workspace/integrations-gemini-ai";
import { extractNZAddress } from "../address-parser";

const mockedGenerateContent = vi.mocked(ai.models.generateContent);

describe("NZ address extraction", () => {
  beforeEach(() => {
    mockedGenerateContent.mockReset();
  });

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

  it("preserves slash-unit addresses instead of extracting the parent street number", async () => {
    await expect(
      extractNZAddress("1/289 Ulster Street, Whitiora. What would the expected costs be to own this property as a rental."),
    ).resolves.toBe("1/289 Ulster Street, Whitiora");
  });

  it("preserves selected Queenstown locality context so direct analysis is not re-disambiguated", async () => {
    await expect(extractNZAddress("102 Thompson Street, Queenstown 9300, New Zealand")).resolves.toBe(
      "102 Thompson Street, Queenstown 9300, New Zealand",
    );
    await expect(extractNZAddress("分析 102 Thompson Street, Queenstown 9300, New Zealand")).resolves.toBe(
      "102 Thompson Street, Queenstown 9300, New Zealand",
    );
  });

  it("preserves Lower Hutt locality context from selected addresses", async () => {
    await expect(
      extractNZAddress("Analyse 15 Parenga Street, Wainuiomata, Lower Hutt 5014, New Zealand"),
    ).resolves.toBe("15 Parenga Street, Wainuiomata, Lower Hutt 5014, New Zealand");
  });

  it("accepts AI-extracted numbered street lines without a conventional suffix", async () => {
    mockedGenerateContent.mockResolvedValueOnce({ text: "1 Broadway, Newmarket, Auckland" } as Awaited<ReturnType<typeof ai.models.generateContent>>);

    await expect(extractNZAddress("Analyse 1 Broadway Newmarket")).resolves.toBe(
      "1 Broadway, Newmarket, Auckland",
    );
  });
});
