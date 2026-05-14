/**
 * Keep long-running work alive after the HTTP response is sent (Vercel serverless).
 * Falls back to a floating promise in local dev when @vercel/functions is unavailable.
 */
export function runAfterResponse(work: Promise<unknown>): void {
  void import("@vercel/functions")
    .then(({ waitUntil }) => {
      waitUntil(work);
    })
    .catch(() => {
      void work;
    });
}
