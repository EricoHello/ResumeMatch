import type { ResumeProfile } from "@/lib/analysis/types";

import type { JobMatch } from "./types";

const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export class JobSearchClientError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "JobSearchClientError";
  }
}

function parseRetryAfter(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds))
    : undefined;
}

function isJobMatch(value: unknown): value is JobMatch {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === "string" &&
    typeof job.title === "string" &&
    typeof job.company === "string" &&
    typeof job.location === "string" &&
    (typeof job.salary === "string" || job.salary === null) &&
    typeof job.applyUrl === "string" &&
    (typeof job.postedAt === "string" || job.postedAt === null) &&
    (typeof job.employmentType === "string" || job.employmentType === null) &&
    typeof job.isRemote === "boolean" &&
    Array.isArray(job.matchedSkills) &&
    job.matchedSkills.every((skill) => typeof skill === "string")
  );
}

async function responseErrorMessage(response: Response) {
  const fallback = "We couldn’t search for jobs right now. Please try again.";
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
    const error = body.error;
    return typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
      ? error.message
      : fallback;
  } catch {
    return fallback;
  }
}

export async function searchJobs(
  profile: ResumeProfile,
  signal: AbortSignal,
): Promise<JobMatch[]> {
  let response: Response;
  try {
    response = await fetch("/api/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new JobSearchClientError(
      "We couldn’t reach the job-search service. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    throw new JobSearchClientError(
      await responseErrorMessage(response),
      response.status,
      parseRetryAfter(response),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new JobSearchClientError("The job-search service returned an unexpected response.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("jobs" in body) ||
    !Array.isArray(body.jobs) ||
    body.jobs.length > 3 ||
    !body.jobs.every(isJobMatch)
  ) {
    throw new JobSearchClientError("The job-search service returned an unexpected response.");
  }

  return body.jobs;
}
