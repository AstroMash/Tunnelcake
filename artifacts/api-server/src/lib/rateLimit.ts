import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
}

// Minimal in-memory fixed-window rate limiter. Suitable for a single-user
// local tool; avoids pulling in an external dependency.
export function createRateLimiter(opts: RateLimiterOptions) {
  const { windowMs, max } = opts;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip ?? "unknown");
  const buckets = new Map<string, Bucket>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    // Opportunistic cleanup to keep the map bounded.
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k);
      }
    }

    const key = keyFn(req);
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}
