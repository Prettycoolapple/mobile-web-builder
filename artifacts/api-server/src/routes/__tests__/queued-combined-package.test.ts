import { describe, expect, it } from "vitest";
import { resolveConfirmedQueuedPackage } from "../../lib/queued-combined-package";

describe("confirmed queued combined package fallback", () => {
  it("preserves the canonical package when the mobile worker's second live lookup is unavailable", () => {
    expect(resolveConfirmedQueuedPackage(
      "39-43 Auranga Road, Karaka",
      "39 - 43 Auranga Drive, Karaka, Franklin, Auckland",
    )).toEqual({
      packageAddress: "39 - 43 Auranga Drive, Karaka, Franklin, Auckland",
      childAddresses: [
        "39 Auranga Drive, Karaka, Franklin, Auckland",
        "41 Auranga Drive, Karaka, Franklin, Auckland",
        "43 Auranga Drive, Karaka, Franklin, Auckland",
      ],
      listingUrl: null,
    });
  });

  it("does not promote an unconfirmed raw range or a normal single address", () => {
    expect(resolveConfirmedQueuedPackage(
      "39-43 Example Street, Auckland",
      "39-43 Example Street, Auckland",
    )).toBeNull();
    expect(resolveConfirmedQueuedPackage(
      "43 Auranga Drive, Karaka",
      "43 Auranga Drive, Karaka, Franklin, Auckland",
    )).toBeNull();
  });
});
