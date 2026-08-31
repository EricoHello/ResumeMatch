import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const jsearchMocks = vi.hoisted(() => {
  class TestConfigurationError extends Error {}
  class TestProviderError extends Error {
    constructor(readonly status?: number) {
      super("provider detail");
    }
  }
  class TestResponseError extends Error {}
  return {
    search: vi.fn(),
    TestConfigurationError,
    TestProviderError,
    TestResponseError,
  };
});

const rateLimitMocks = vi.hoisted(() => ({
  clientKey: vi.fn(() => "203.0.113.20"),
  consume: vi.fn(),
}));

vi.mock("@/lib/jobs/jsearch", () => ({
  jSearchClient: { search: jsearchMocks.search },
  JSearchConfigurationError: jsearchMocks.TestConfigurationError,
  JSearchProviderError: jsearchMocks.TestProviderError,
  JSearchResponseError: jsearchMocks.TestResponseError,
}));

vi.mock("@/lib/jobs/rate-limit", () => ({
  jobSearchClientKey: rateLimitMocks.clientKey,
  jobSearchRateLimiter: { consume: rateLimitMocks.consume },
}));

import {
  MAX_JOB_SEARCH_REQUEST_BYTES,
  POST,
} from "@/app/api/jobs/search/route";

const PROFILE = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"],
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
    minimumSalary: 145_000,
  },
};
const JOBS = [
  {
    id: "job-1",
    title: "Staff Software Engineer",
    company: "Example",
    location: "Seattle, WA",
    salary: null,
    applyUrl: "https://jobs.example.test/1",
    postedAt: "2 days ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: ["TypeScript"],
  },
];

function request(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/jobs/search", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-real-ip": "203.0.113.20",
    },
    body,
  });
}

describe("POST /api/jobs/search", () => {
  beforeEach(() => {
    vi.stubEnv("MAINTENANCE_MODE", "false");
    jsearchMocks.search.mockReset().mockResolvedValue(JOBS);
    rateLimitMocks.consume.mockReset().mockReturnValue({
      allowed: true,
      remaining: 2,
    });
    rateLimitMocks.clientKey.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns maintenance mode without consuming quota or calling JSearch", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "true");

    const response = await POST(request(JSON.stringify({ profile: PROFILE })));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAINTENANCE_MODE" },
    });
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(jsearchMocks.search).not.toHaveBeenCalled();
  });

  it("searches once with the existing profile and returns no-store results", async () => {
    const apiRequest = request(JSON.stringify({ profile: PROFILE }));
    const response = await POST(apiRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.jobs).toEqual(JOBS);
    expect(body.searchedAt).toEqual(expect.any(String));
    expect(jsearchMocks.search).toHaveBeenCalledOnce();
    expect(jsearchMocks.search).toHaveBeenCalledWith(PROFILE, apiRequest.signal);
  });

  it("rejects malformed, oversized, and extra input before using quota", async () => {
    const malformed = await POST(request("{bad"));
    const oversized = await POST(
      request(JSON.stringify({ profile: PROFILE, padding: "x".repeat(MAX_JOB_SEARCH_REQUEST_BYTES) })),
    );
    const extra = await POST(
      request(JSON.stringify({ profile: PROFILE, resumeText: "do not send" })),
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(extra.status).toBe(422);
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(jsearchMocks.search).not.toHaveBeenCalled();
  });

  it("rate limits before calling JSearch", async () => {
    rateLimitMocks.consume.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 41,
    });
    const response = await POST(request(JSON.stringify({ profile: PROFILE })));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("41");
    expect(jsearchMocks.search).not.toHaveBeenCalled();
  });

  it("maps configuration and provider failures to safe responses", async () => {
    jsearchMocks.search.mockRejectedValueOnce(
      new jsearchMocks.TestConfigurationError("OPENWEBNINJA_API_KEY detail"),
    );
    const unavailable = await POST(request(JSON.stringify({ profile: PROFILE })));
    const unavailableBody = await unavailable.json();
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(unavailableBody)).not.toContain("OPENWEBNINJA");

    jsearchMocks.search.mockRejectedValueOnce(new jsearchMocks.TestProviderError(429));
    const quota = await POST(request(JSON.stringify({ profile: PROFILE })));
    expect(quota.status).toBe(429);
    expect(quota.headers.get("retry-after")).toBe("60");
  });
});
