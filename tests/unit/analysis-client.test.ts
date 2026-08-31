import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeResume,
  ResumeAnalysisClientError,
} from "@/lib/analysis/client";

const INPUT = {
  resumeText:
    "Ada Lovelace\nSenior Software Engineer\nBuilt TypeScript distributed systems.",
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"] as const,
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"] as const,
    minimumSalary: 140_000,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeResume", () => {
  it("preserves a safe 429 retry interval for the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "Resume analysis has reached its current quota.",
            },
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "37",
            },
          },
        ),
      ),
    );

    const error = await analyzeResume(INPUT, new AbortController().signal).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ResumeAnalysisClientError);
    expect(error).toMatchObject({
      status: 429,
      retryAfterSeconds: 37,
      message: "Resume analysis has reached its current quota.",
    });
  });
});
