import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const geminiMocks = vi.hoisted(() => {
  class TestGeminiConfigurationError extends Error {}
  class TestGeminiProviderError extends Error {
    constructor(readonly status?: number) {
      super("provider failure");
    }
  }
  class TestGeminiResponseError extends Error {}

  return {
    analyze: vi.fn(),
    TestGeminiConfigurationError,
    TestGeminiProviderError,
    TestGeminiResponseError,
  };
});

const rateLimitMocks = vi.hoisted(() => ({
  clientKey: vi.fn(() => "203.0.113.10"),
  consume: vi.fn(),
}));

vi.mock("@/lib/analysis/gemini", () => ({
  geminiResumeAnalyzer: { analyze: geminiMocks.analyze },
  GeminiConfigurationError: geminiMocks.TestGeminiConfigurationError,
  GeminiProviderError: geminiMocks.TestGeminiProviderError,
  GeminiResponseError: geminiMocks.TestGeminiResponseError,
}));

vi.mock("@/lib/analysis/rate-limit", () => ({
  analysisClientKey: rateLimitMocks.clientKey,
  analysisRateLimiter: { consume: rateLimitMocks.consume },
}));

import {
  MAX_ANALYZE_REQUEST_BYTES,
  POST,
} from "@/app/api/resumes/analyze/route";

const INPUT = {
  resumeText:
    "Ada Lovelace\nSenior Software Engineer\nBuilt TypeScript distributed systems.",
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"],
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
    minimumSalary: 140_000,
  },
};
const PROFILE = {
  summary: "Senior software engineer focused on distributed systems.",
  resumeImprovement:
    "The resume is coherent; tighten repeated wording around systems work. Build a TypeScript reliability dashboard to reinforce the target platform roles.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["TypeScript distributed systems"],
  preferences: INPUT.preferences,
};

function analyzeRequest(
  body: string,
  options: { contentType?: string; contentLength?: number } = {},
) {
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "x-real-ip": "203.0.113.10",
  });

  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }

  return new Request("http://localhost/api/resumes/analyze", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/resumes/analyze", () => {
  beforeEach(() => {
    vi.stubEnv("MAINTENANCE_MODE", "false");
    geminiMocks.analyze.mockReset();
    rateLimitMocks.clientKey.mockClear();
    rateLimitMocks.consume.mockReset();
    rateLimitMocks.consume.mockReturnValue({ allowed: true, remaining: 4 });
    geminiMocks.analyze.mockResolvedValue(PROFILE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns maintenance mode without consuming quota or calling Gemini", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "true");

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAINTENANCE_MODE" },
    });
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("analyzes normalized text and returns only the profile", async () => {
    const request = analyzeRequest(
      JSON.stringify({
        ...INPUT,
        resumeText: `  ${INPUT.resumeText.replaceAll("\n", "\r\n")}  `,
      }),
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ profile: PROFILE });
    expect(rateLimitMocks.clientKey).toHaveBeenCalledOnce();
    expect(rateLimitMocks.consume).toHaveBeenCalledWith("203.0.113.10");
    expect(geminiMocks.analyze).toHaveBeenCalledWith(INPUT, request.signal);
  });

  it("rejects unsupported content types before reading or analyzing", async () => {
    const response = await POST(
      analyzeRequest(JSON.stringify(INPUT), { contentType: "text/plain" }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(analyzeRequest("{not valid json"));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before consuming it", async () => {
    const response = await POST(
      analyzeRequest(JSON.stringify(INPUT), {
        contentLength: MAX_ANALYZE_REQUEST_BYTES + 1,
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("enforces the body bound even without Content-Length", async () => {
    const response = await POST(
      analyzeRequest(
        JSON.stringify({
          ...INPUT,
          resumeText: "x".repeat(MAX_ANALYZE_REQUEST_BYTES),
        }),
      ),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("rejects invalid or extra analysis input before rate limiting", async () => {
    const response = await POST(
      analyzeRequest(JSON.stringify({ ...INPUT, uid: "attacker-controlled" })),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ANALYSIS_INPUT" },
    });
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("returns Retry-After when the local quota guard is exhausted", async () => {
    rateLimitMocks.consume.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 37,
    });

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("37");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(geminiMocks.analyze).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable response when the server key is absent", async () => {
    geminiMocks.analyze.mockRejectedValue(
      new geminiMocks.TestGeminiConfigurationError(
        "secret configuration detail",
      ),
    );

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ error: { code: "ANALYSIS_UNAVAILABLE" } });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("maps Gemini free-tier quota errors to a safe retryable response", async () => {
    geminiMocks.analyze.mockRejectedValue(
      new geminiMocks.TestGeminiProviderError(429),
    );

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });

  it.each([
    new geminiMocks.TestGeminiProviderError(500),
    new geminiMocks.TestGeminiResponseError("invalid model response"),
  ])("maps provider and model-output failures to a safe 502", async (error) => {
    geminiMocks.analyze.mockRejectedValue(error);

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ error: { code: "ANALYSIS_FAILED" } });
    expect(JSON.stringify(body)).not.toContain("model response");
  });

  it("does not expose unexpected server failures", async () => {
    geminiMocks.analyze.mockRejectedValue(
      new Error("api-key-or-private-resume-content"),
    );

    const response = await POST(analyzeRequest(JSON.stringify(INPUT)));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain("private-resume");
  });
});
