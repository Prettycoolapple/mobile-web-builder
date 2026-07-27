import { describe, expect, it } from "vitest";
import { isSubdivisionLayoutRequest } from "../subdivision-layout-intent";

describe("subdivision layout presentation intent", () => {
  it.each([
    "Visualize subdivision options",
    "Show me the subdivision layout",
    "Generate a site scheme",
    "一键生成AI分割布局",
    "查看分割方案",
  ])("recognises %s", (message) => {
    expect(isSubdivisionLayoutRequest(message)).toBe(true);
  });

  it("does not treat ordinary subdivision questions as layout actions", () => {
    expect(isSubdivisionLayoutRequest("What are the subdivision risks?")).toBe(false);
    expect(isSubdivisionLayoutRequest("Explain the subdivision rules")).toBe(false);
  });
});
