import {
  EXPERIENCE_LEVELS,
  type AnalyzeResumeRequest,
  type ResumeProfile,
} from "@/lib/analysis/types";
import { parseJobPreferences } from "@/lib/preferences/validation";

const EXPERIENCE_LEVEL_SET = new Set<string>(EXPERIENCE_LEVELS);
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

type ResumeAnalysisClientErrorOptions = {
  status?: number;
  retryAfterSeconds?: number;
};

export class ResumeAnalysisClientError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    { status, retryAfterSeconds }: ResumeAnalysisClientErrorOptions = {},
  ) {
    super(message);
    this.name = "ResumeAnalysisClientError";
    this.status = Number.isInteger(status) ? status ?? null : null;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;

  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(numericSeconds));
  }

  const retryDate = Date.parse(value);
  if (!Number.isFinite(retryDate)) return undefined;

  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(0, Math.ceil((retryDate - Date.now()) / 1000)),
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseResumeProfile(value: unknown): ResumeProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const profile = value as Record<string, unknown>;

  if (!(
    typeof profile.summary === "string" &&
    typeof profile.experienceLevel === "string" &&
    EXPERIENCE_LEVEL_SET.has(profile.experienceLevel) &&
    isStringArray(profile.skills) &&
    isStringArray(profile.recentJobTitles) &&
    isStringArray(profile.targetRoles) &&
    isStringArray(profile.searchKeywords)
  )) {
    return null;
  }

  try {
    return {
      summary: profile.summary,
      experienceLevel: profile.experienceLevel as ResumeProfile["experienceLevel"],
      skills: profile.skills,
      recentJobTitles: profile.recentJobTitles,
      targetRoles: profile.targetRoles,
      searchKeywords: profile.searchKeywords,
      preferences: parseJobPreferences(profile.preferences),
    };
  } catch {
    return null;
  }
}

async function errorMessage(response: Response) {
  const fallback = "We couldn’t analyze your resume. Please try again.";

  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return fallback;
    }

    const error = body.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  } catch {
    // Empty and non-JSON responses use the stable fallback above.
  }

  return fallback;
}

export async function analyzeResume(
  input: AnalyzeResumeRequest,
  signal: AbortSignal,
): Promise<ResumeProfile> {
  let response: Response;

  try {
    response = await fetch("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ResumeAnalysisClientError(
      "We couldn’t reach the analysis service. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    throw new ResumeAnalysisClientError(await errorMessage(response), {
      status: response.status,
      retryAfterSeconds: parseRetryAfter(response),
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ResumeAnalysisClientError(
      "The analysis service returned an unexpected response.",
      { status: response.status },
    );
  }

  const profile =
    typeof body !== "object" ||
    body === null ||
    !("profile" in body)
      ? null
      : parseResumeProfile(body.profile);
  if (!profile) {
    throw new ResumeAnalysisClientError(
      "The analysis service returned an unexpected response.",
      { status: response.status },
    );
  }

  return profile;
}
