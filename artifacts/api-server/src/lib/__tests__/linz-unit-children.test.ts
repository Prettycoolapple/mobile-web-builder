import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLINZUnitChildAddresses } from "../linz";

describe("LINZ numeric slash-unit child lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers verified children even when the parent query would return only the parent", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q") ?? "";
      const match = query.match(/^([12])\/144 Sunset Road/i);
      const unit = match?.[1] ?? null;
      return new Response(JSON.stringify({
        data: unit
          ? [{
              id: `child-${unit}`,
              address: `${unit}/144 Sunset Road, Unsworth Heights, Auckland`,
              source: "address",
              rank: 0.64,
              shape: {
                type: "Point",
                coordinates: [174.726, -36.7557],
              },
            }]
          : [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const children = await fetchLINZUnitChildAddresses(
      "144 Sunset Road, Unsworth Heights",
      { maxUnit: 4 },
    );

    expect(children.map((child) => child.address)).toEqual([
      "1/144 Sunset Road, Unsworth Heights, Auckland",
      "2/144 Sunset Road, Unsworth Heights, Auckland",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not probe when the user already selected a slash-unit child", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchLINZUnitChildAddresses("1/144 Sunset Road, Unsworth Heights"),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
