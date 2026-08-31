import { ApiError, ThinkingLevel } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_RESUME_MODEL,
  GEMINI_TIMEOUT_MS,
  GeminiConfigurationError,
  GeminiProviderError,
  GeminiResponseError,
  GeminiResumeAnalyzer,
  RESUME_ANALYSIS_RESPONSE_SCHEMA,
  type GenerateContent,
} from "@/lib/analysis/gemini";

const INPUT = {
  resumeText:
    "Ada Lovelace\nSenior Software Engineer\nBuilt TypeScript distributed systems.",
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangement: "any" as const,
    minimumSalary: 140_000,
  },
};
const GENERATED = {
  summary: "Senior software engineer focused on distributed systems.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["TypeScript distributed systems"],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GeminiResumeAnalyzer", () => {
  it("fails before making a request when the server API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(new GeminiResumeAnalyzer().analyze(INPUT)).rejects.toBeInstanceOf(
      GeminiConfigurationError,
    );
  });

  it("makes one bounded structured call and appends preferences server-side", async () => {
    const generate = vi.fn<GenerateContent>().mockResolvedValue({
      text: JSON.stringify(GENERATED),
    });
    const analyzer = new GeminiResumeAnalyzer(generate);
    const requestController = new AbortController();

    await expect(analyzer.analyze(INPUT, requestController.signal)).resolves.toEqual({
      ...GENERATED,
      preferences: INPUT.preferences,
    });
    expect(generate).toHaveBeenCalledOnce();

    const parameters = generate.mock.calls[0][0];
    expect(parameters.model).toBe(GEMINI_RESUME_MODEL);
    expect(parameters.contents).toContain("BEGIN_UNTRUSTED_INPUT_JSON");
    expect(parameters.contents).toContain(JSON.stringify(INPUT.resumeText));
    expect(parameters.contents).toContain(JSON.stringify(INPUT.preferences));
    expect(parameters.config).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: RESUME_ANALYSIS_RESPONSE_SCHEMA,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      httpOptions: {
        timeout: GEMINI_TIMEOUT_MS,
        retryOptions: {
          attempts: 2,
          initialDelay: 0.25,
          maxDelay: 0.5,
        },
      },
    });
    expect(parameters.config).not.toHaveProperty("tools");
    expect(parameters.config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(parameters.config?.abortSignal).not.toBe(requestController.signal);
    expect(parameters.config?.abortSignal?.aborted).toBe(false);
    requestController.abort();
    expect(parameters.config?.abortSignal?.aborted).toBe(true);
    expect(String(parameters.config?.systemInstruction)).toContain(
      "untrusted source data",
    );
    expect(String(parameters.config?.systemInstruction)).toMatch(
      /contact\s+details/,
    );
    expect(String(parameters.config?.systemInstruction)).toMatch(
      /personal\s+identifiers/,
    );
  });

  it.each([
    undefined,
    "not json",
    JSON.stringify({ ...GENERATED, uid: "unexpected" }),
    JSON.stringify({ ...GENERATED, experienceLevel: "principal" }),
  ])("rejects an invalid structured model response", async (text) => {
    const generate = vi.fn<GenerateContent>().mockResolvedValue({ text });

    await expect(
      new GeminiResumeAnalyzer(generate).analyze(INPUT),
    ).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("converts provider failures to an error without provider details", async () => {
    const generate = vi
      .fn<GenerateContent>()
      .mockRejectedValue(new Error("secret-api-key-and-provider-details"));

    const error = await new GeminiResumeAnalyzer(generate)
      .analyze(INPUT)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(String(error)).not.toContain("secret-api-key");
  });

  it("preserves only the status from a Gemini API quota error", async () => {
    const generate = vi.fn<GenerateContent>().mockRejectedValue(
      new ApiError({
        status: 429,
        message: "quota response containing provider internals",
      }),
    );

    const error = await new GeminiResumeAnalyzer(generate)
      .analyze(INPUT)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(error).toMatchObject({ status: 429 });
    expect(String(error)).not.toContain("provider internals");
  });
});
