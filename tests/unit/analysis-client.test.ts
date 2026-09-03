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
const PROFILE = {
  summary: "Senior software engineer focused on distributed systems.",
  resumeImprovement:
    "The resume is coherent; tighten repeated systems wording. Build a TypeScript reliability dashboard to reinforce the target platform roles.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["TypeScript distributed systems"],
  preferences: INPUT.preferences,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeResume", () => {
  it("returns the resume improvement from the existing analysis response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ profile: PROFILE }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      analyzeResume(INPUT, new AbortController().signal),
    ).resolves.toEqual(PROFILE);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an analysis response without a resume improvement", async () => {
    const incompleteProfile = Object.fromEntries(
      Object.entries(PROFILE).filter(([key]) => key !== "resumeImprovement"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ profile: incompleteProfile })),
    );

    await expect(
      analyzeResume(INPUT, new AbortController().signal),
    ).rejects.toBeInstanceOf(ResumeAnalysisClientError);
  });

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
