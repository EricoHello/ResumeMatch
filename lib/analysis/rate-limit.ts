import "server-only";

import { isIP } from "node:net";

export const ANALYSIS_RATE_LIMIT = 5;
export const ANALYSIS_RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_BUCKETS = 10_000;

type RateLimitBucket = {
  count: number;
  windowStartedAt: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export class AnalysisRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit = ANALYSIS_RATE_LIMIT,
    private readonly windowMs = ANALYSIS_RATE_WINDOW_MS,
    private readonly maximumBuckets = MAX_RATE_LIMIT_BUCKETS,
    private readonly now: () => number = Date.now,
  ) {}

  consume(clientKey: string): RateLimitResult {
    const currentTime = this.now();
    const existing = this.buckets.get(clientKey);

    if (!existing || currentTime - existing.windowStartedAt >= this.windowMs) {
      this.ensureCapacity(currentTime, clientKey);
      this.buckets.set(clientKey, { count: 1, windowStartedAt: currentTime });
      return { allowed: true, remaining: Math.max(0, this.limit - 1) };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (existing.windowStartedAt + this.windowMs - currentTime) / 1_000,
          ),
        ),
      };
    }

    existing.count += 1;
    return { allowed: true, remaining: this.limit - existing.count };
  }

  get bucketCount() {
    return this.buckets.size;
  }

  private ensureCapacity(currentTime: number, incomingKey: string) {
    if (this.buckets.has(incomingKey)) return;

    for (const [key, bucket] of this.buckets) {
      if (currentTime - bucket.windowStartedAt >= this.windowMs) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size >= this.maximumBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.buckets.delete(oldestKey);
    }
  }
}

function normalizedIp(value: string | null) {
  const candidate = value?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function analysisClientKey(request: Request) {
  return normalizedIp(request.headers.get("x-real-ip")) ?? "anonymous";
}

export const analysisRateLimiter = new AnalysisRateLimiter();
