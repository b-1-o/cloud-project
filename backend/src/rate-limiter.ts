export class RateLimiter {
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS rate_buckets (bucket_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)"
    );
  }

  fetch(request: Request): Response {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") || 120)));
    const windowMs = Math.min(300_000, Math.max(1_000, Number(url.searchParams.get("windowMs") || 60_000)));
    if (!key || key.length > 256 || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
      return Response.json({ error: "invalid_rate_limit_request" }, { status: 400 });
    }

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    let count = 0;
    this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec(
        "INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(bucket_key) DO UPDATE SET " +
        "window_start = excluded.window_start, " +
        "count = CASE WHEN rate_buckets.window_start = excluded.window_start THEN rate_buckets.count + 1 ELSE 1 END " +
        "RETURNING count",
        key, windowStart
      ).toArray() as Array<{ count: number }>;
      count = Number(rows[0]?.count || 0);
    });

    const resetSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    if (count > limit) {
      return Response.json({ error: "rate_limited", retryAfter: resetSeconds }, {
        status: 429,
        headers: { "Retry-After": String(resetSeconds), "Cache-Control": "no-store" }
      });
    }
    return Response.json({ allowed: true, remaining: Math.max(0, limit - count), resetSeconds }, {
      headers: { "Cache-Control": "no-store" }
    });
  }
}
