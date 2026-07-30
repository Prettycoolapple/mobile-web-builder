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

  // Phrasings that name a lot COUNT. Wanting a number means wanting to see the
  // arrangement that achieves it, so these land on the plan too.
  it.each([
    "Can 12 Foo Road subdivide into 3 lots?",
    "could this be subdivided into 4 sections",
    "what would a 4-lot layout look like here?",
    "能分成几块",
  ])("recognises the lot-count phrasing %s", (message) => {
    expect(isSubdivisionLayoutRequest(message)).toBe(true);
  });

  // Yield maximisation — the user wants the densest arrangement drawn.
  it.each([
    "subdivide with max yield",
    "squeeze the most lots out of this subdivision",
    "subdivision with maximum density",
    "最大化户数",
  ])("recognises the yield phrasing %s", (message) => {
    expect(isSubdivisionLayoutRequest(message)).toBe(true);
  });

  it("does not treat ordinary subdivision questions as layout actions", () => {
    expect(isSubdivisionLayoutRequest("What are the subdivision risks?")).toBe(false);
    expect(isSubdivisionLayoutRequest("Explain the subdivision rules")).toBe(false);
    expect(isSubdivisionLayoutRequest("How much does subdivision cost in Auckland?")).toBe(false);
  });

  // Yield wording is only a signal alongside subdivision. On its own it reads as
  // a discovery request, and hijacking that to the plan tab would be wrong.
  it("ignores yield wording with no subdivision context", () => {
    expect(isSubdivisionLayoutRequest("show me the best lots in Orakei")).toBe(false);
    expect(isSubdivisionLayoutRequest("which suburb has the highest yield?")).toBe(false);
  });
});
