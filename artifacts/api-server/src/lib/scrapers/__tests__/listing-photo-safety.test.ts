import { describe, expect, it } from "vitest";
import { extractHomesPhotosFromHtml } from "../homes-photos";
import { extractTradeMePhotosFromListingHtml } from "../trademe-property";

describe("listing photo safety filters", () => {
  it("rejects homes.co.nz marketing/app imagery while keeping property CDN paths", async () => {
    const photos = await extractHomesPhotosFromHtml(`
      <img src="https://cdn.homes.co.nz/assets/app-phone-mock.jpg" />
      <img src="https://abc.cloudfront.net/1234567890abcdef.jpg" />
      <img src="https://img.cloudfront.net/property/30-dingle-road/front.jpg" />
      <script>
        window.__photos = ["https:\\/\\/img.cloudfront.net\\/photos\\/30-dingle\\/living.webp"];
      </script>
    `);

    expect(photos).toEqual([
      "https://img.cloudfront.net/property/30-dingle-road/front.jpg",
      "https://img.cloudfront.net/photos/30-dingle/living.webp",
    ]);
  });

  it("rejects Trade Me logos/agent assets while keeping listing photos", async () => {
    const photos = await extractTradeMePhotosFromListingHtml(`
      <img src="https://www.trademe.co.nz/images/logo.jpg" />
      <img src="https://photos.trademe.co.nz/property/agent-avatar.jpg" />
      <picture>
        <source srcset="https://photos.trademe.co.nz/property/5850075796_900.jpg 900w, https://photos.trademe.co.nz/property/5850075796_1200.jpg 1200w" />
      </picture>
    `);

    expect(photos).toEqual(["https://photos.trademe.co.nz/property/5850075796_1200.jpg"]);
  });
});
