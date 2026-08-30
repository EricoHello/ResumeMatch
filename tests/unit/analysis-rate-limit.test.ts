import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AnalysisRateLimiter,
  analysisClientKey,
} from "@/lib/analysis/rate-limit";

describe("AnalysisRateLimiter", () => {
  it("allows a bounded number of calls and reports a retry interval", () => {
    let now = 10_000;
    const limiter = new AnalysisRateLimiter(2, 60_000, 10, () => now);

    expect(limiter.consume("client")).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume("client")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    now += 59_500;
    expect(limiter.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });

    now += 500;
    expect(limiter.consume("client")).toEqual({ allowed: true, remaining: 1 });
  });

  it("prunes expired entries and never exceeds its bucket cap", () => {
    let now = 0;
    const limiter = new AnalysisRateLimiter(1, 1_000, 2, () => now);

    limiter.consume("one");
    limiter.consume("two");
    limiter.consume("three");
    expect(limiter.bucketCount).toBe(2);

    now = 1_001;
    limiter.consume("four");
    expect(limiter.bucketCount).toBe(1);
  });
});

describe("analysisClientKey", () => {
  it("uses Railway's validated real-IP header", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-real-ip": " 203.0.113.10 ",
      },
    });

    expect(analysisClientKey(request)).toBe("203.0.113.10");
  });

  it("ignores forwarded values and uses a shared bucket without a valid real IP", () => {
    expect(
      analysisClientKey(
        new Request("http://localhost", {
          headers: {
            "x-forwarded-for": "203.0.113.10, 198.51.100.2",
          },
        }),
      ),
    ).toBe("anonymous");

    expect(
      analysisClientKey(
        new Request("http://localhost", {
          headers: {
            "x-forwarded-for": "203.0.113.10",
            "x-real-ip": "not-an-ip",
          },
        }),
      ),
    ).toBe("anonymous");
  });
});
