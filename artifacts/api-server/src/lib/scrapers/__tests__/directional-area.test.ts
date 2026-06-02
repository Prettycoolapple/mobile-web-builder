import { describe, it, expect } from "vitest";
import { resolveDistrictToSuburbs, detectDirectionalAreaTerm } from "../realestate-search";

describe("directional / central area → Auckland context", () => {
  it("resolves 'central' to a spread of Auckland isthmus suburbs (not NZ-wide)", () => {
    const subs = resolveDistrictToSuburbs("central");
    expect(subs).not.toBeNull();
    expect(subs!.length).toBeGreaterThan(0);
    // must include well-known central Auckland suburbs, and NOT Te Puke / Tawa
    expect(subs).toContain("mt albert");
    expect(subs).not.toContain("te puke");
    expect(subs).not.toContain("tawa");
  });

  it("resolves each English direction to Auckland suburbs", () => {
    for (const dir of ["central", "east", "south", "west", "north"]) {
      const subs = resolveDistrictToSuburbs(dir);
      expect(subs, `direction ${dir}`).not.toBeNull();
      expect(subs!.length, `direction ${dir}`).toBeGreaterThan(0);
    }
  });

  it("caps the fan-out so 'central' never explodes into 40 parallel searches", () => {
    const subs = resolveDistrictToSuburbs("central");
    expect(subs!.length).toBeLessThanOrEqual(12);
  });

  it("resolves Chinese directional terms (中区/东区/南区/西区/北区)", () => {
    expect(resolveDistrictToSuburbs("中区")).not.toBeNull();
    expect(resolveDistrictToSuburbs("东区")).not.toBeNull();
    expect(resolveDistrictToSuburbs("南区")).not.toBeNull();
    expect(resolveDistrictToSuburbs("西区")).not.toBeNull();
    expect(resolveDistrictToSuburbs("北区")).not.toBeNull();
  });

  it("does NOT treat a real suburb containing a direction word as directional", () => {
    // "east tamaki" is a leaf suburb — must not fan out as "east"
    expect(resolveDistrictToSuburbs("east tamaki")).toBeNull();
    expect(resolveDistrictToSuburbs("south dunedin")).toBeNull();
  });

  it("detects a directional term embedded in a free-text query (EN + zh)", () => {
    expect(detectDirectionalAreaTerm("what is on sale around $1.5M-$2M in central")).toBe("central");
    expect(detectDirectionalAreaTerm("中区有什么150万-200万的吗")).toBe("central");
    expect(detectDirectionalAreaTerm("anything in west auckland under 1m")).toBe("west");
    expect(detectDirectionalAreaTerm("北岸有没有可以分割的")).toBe("north");
  });

  it("returns null when no directional term is present", () => {
    expect(detectDirectionalAreaTerm("what is available in orakei")).toBeNull();
    expect(detectDirectionalAreaTerm("anything in ponsonby under 2m")).toBeNull();
  });

  // NOTE: detectDirectionalAreaTerm is intentionally a naive detector used ONLY
  // as a fallback after real-suburb resolution fails. A bare direction word in a
  // longer suburb name (e.g. "east tamaki") would be caught upstream by the
  // suburb index first, so the fallback never runs for it in production.
});
