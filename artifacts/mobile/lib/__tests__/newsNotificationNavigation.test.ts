import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPendingNewsDestination,
  parsePendingNewsNavigation,
  pendingNewsNavigationFromData,
} from "../newsNotificationNavigation";

describe("News notification navigation", () => {
  it("accepts only a valid News post notification", () => {
    assert.deepEqual(pendingNewsNavigationFromData({ type: "news_post", postId: "post-123" }, "notification-1", 42), {
      postId: "post-123",
      notificationId: "notification-1",
      queuedAt: 42,
    });
    assert.equal(pendingNewsNavigationFromData({ type: "watchlist_change", postId: "post-123" }), null);
    assert.equal(pendingNewsNavigationFromData({ type: "news_post" }), null);
  });

  it("rejects corrupt persisted navigation state", () => {
    assert.equal(parsePendingNewsNavigation(null), null);
    assert.equal(parsePendingNewsNavigation("{bad json"), null);
    assert.equal(parsePendingNewsNavigation(JSON.stringify({ postId: "", queuedAt: 1 })), null);
    assert.deepEqual(parsePendingNewsNavigation(JSON.stringify({ postId: "post-123", queuedAt: 42 })), {
      postId: "post-123",
      notificationId: null,
      queuedAt: 42,
    });
  });

  it("recognizes the committed article destination", () => {
    assert.equal(isPendingNewsDestination("/news/post-123", "post-123"), true);
    assert.equal(isPendingNewsDestination("/news/post-123/", "post-123"), true);
    assert.equal(isPendingNewsDestination("/news", "post-123"), false);
  });
});
