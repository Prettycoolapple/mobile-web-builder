import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRubinScenario, fetchRubinSite, RubinError } from "../rubin";

/**
 * Rubin's status codes are part of its frozen v1 contract, and the whole
 * gating story depends on reading them correctly: a 404 there means "we do not
 * cover this address", not "something broke". Getting that mapping wrong is how
 * a user ends up staring at a raw error for a Wellington property.
 */

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchRubinSite", () => {
  it("returns the parsed site on success", async () => {
    mockFetch(200, {
      site: { address: "14 Lawndale Place", parcelId: "5171002", zone: "Mixed Housing Suburban", areaM2: 1168 },
      subdivisionSupported: true,
    });
    const result = await fetchRubinSite({ address: "14 Lawndale Place" });
    expect(result.subdivisionSupported).toBe(true);
    expect(result.site.parcelId).toBe("5171002");
  });

  it("maps 404 (outside Auckland / unknown address) to `unsupported`", async () => {
    mockFetch(404, { error: 'No cadastral parcel found at "120 Oriental Parade, Wellington"' });
    const err = await fetchRubinSite({ address: "120 Oriental Parade" }).catch((e) => e);
    expect(err).toBeInstanceOf(RubinError);
    expect(err.kind).toBe("unsupported");
    expect(err.status).toBe(404);
  });

  it("maps 422 (rural / business zone) to `unsupported`", async () => {
    mockFetch(422, { error: "Unsupported zone", detail: 'No AUP rule set for zone "Business - City Centre Zone".' });
    const err = await fetchRubinSite({ address: "171 Queen Street" }).catch((e) => e);
    expect(err.kind).toBe("unsupported");
    expect(err.status).toBe(422);
    expect(err.detail).toContain("Business - City Centre Zone");
  });

  it("maps 502 (LINZ / council upstream) to a retryable `upstream`", async () => {
    mockFetch(502, { error: "Site data fetch failed" });
    const err = await fetchRubinSite({ address: "x" }).catch((e) => e);
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
  });

  it("maps 400 to `bad-request` and reports 500 — a malformed request is our defect", async () => {
    mockFetch(400, { error: "Invalid JSON body" });
    const err = await fetchRubinSite({ address: "x" }).catch((e) => e);
    expect(err.kind).toBe("bad-request");
    expect(err.status).toBe(500);
  });

  it("maps an aborted request to `timeout` rather than a generic failure", async () => {
    const abort = new Error("The operation was aborted due to timeout");
    abort.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }) as unknown as typeof fetch);
    const err = await fetchRubinSite({ address: "x" }).catch((e) => e);
    expect(err.kind).toBe("timeout");
    expect(err.status).toBe(504);
  });
});

describe("fetchRubinScenario", () => {
  it("always sends the scenario — omitting it makes Rubin solve both serially", async () => {
    const spy = mockFetch(200, { site: {}, scenarios: [], solverVersion: "2026.07.28", cacheEnabled: true });
    await fetchRubinScenario({ address: "14 Lawndale Place", scenario: "high-end" });
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ address: "14 Lawndale Place", scenario: "high-end" });
  });

  it("passes coordinates through when supplied", async () => {
    const spy = mockFetch(200, { site: {}, scenarios: [], solverVersion: "x", cacheEnabled: false });
    await fetchRubinScenario({ lat: -36.86, lng: 174.85, scenario: "max-yield" });
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ lat: -36.86, lng: 174.85, scenario: "max-yield" });
  });

  it("surfaces an empty scenarios array rather than inventing a layout", async () => {
    mockFetch(200, { site: {}, scenarios: [], solverVersion: "2026.07.28", cacheEnabled: true });
    const result = await fetchRubinScenario({ address: "x", scenario: "max-yield" });
    // The route turns this into `solved: false, reason: "no-layout"`.
    expect(result.scenarios).toEqual([]);
  });
});
