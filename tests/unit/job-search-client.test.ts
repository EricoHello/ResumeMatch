import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSearchClientError, searchJobs } from "@/lib/jobs/client";

const PROFILE = {
  summary: "Senior platform engineer.",
  resumeImprovement:
    "The resume is coherent; make one platform outcome more specific. Build a TypeScript reliability dashboard to reinforce the target roles.",
  experienceLevel: "senior" as const,
  skills: ["TypeScript"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote"] as const,
    employmentTypes: ["full_time"] as const,
    minimumSalary: 145_000,
  },
};
const JOB = {
  id: "job-1",
  title: "Staff Software Engineer",
  company: "Northstar",
  location: "Seattle, WA",
  salary: null,
  applyUrl: "https://jobs.example.test/one",
  postedAt: "2 days ago",
  employmentType: "FULLTIME",
  isRemote: false,
  matchedSkills: ["TypeScript"],
};
const REWARD_CONTEXT = {
  searchId: "search-123",
  clickTokens: ["click-token-1"],
};

describe("searchJobs client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates signed-in searches and returns card reward context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        jobs: [JOB],
        searchedAt: "2026-09-01T12:00:00.000Z",
        rewardContext: REWARD_CONTEXT,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = {
      getIdToken: vi.fn().mockResolvedValue("firebase-token"),
    } as unknown as User;

    await expect(
      searchJobs(PROFILE, new AbortController().signal, user),
    ).resolves.toEqual({ jobs: [JOB], rewardContext: REWARD_CONTEXT });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer firebase-token",
    });
  });

  it("accepts older guest responses without reward context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ jobs: [JOB] })),
    );

    await expect(
      searchJobs(PROFILE, new AbortController().signal),
    ).resolves.toEqual({ jobs: [JOB], rewardContext: null });
  });

  it("rejects reward tokens that do not map one-to-one to displayed jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          jobs: [JOB],
          rewardContext: {
            searchId: "search-123",
            clickTokens: ["token-one", "token-two"],
          },
        }),
      ),
    );

    await expect(
      searchJobs(PROFILE, new AbortController().signal),
    ).rejects.toBeInstanceOf(JobSearchClientError);
  });
});
