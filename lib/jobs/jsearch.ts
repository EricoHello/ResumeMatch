import "server-only";

import type { ResumeProfile } from "@/lib/analysis/types";

import { rankJobCandidates } from "./ranking";
import type { JobCandidate, JobMatch } from "./types";

const JSEARCH_ENDPOINT = "https://api.openwebninja.com/jsearch/search-v2";
const SEARCH_TIMEOUT_MS = 30_000;

export class JSearchConfigurationError extends Error {}

export class JSearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JSearchProviderError";
  }
}

export class JSearchResponseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function safeUrl(value: unknown) {
  const raw = textValue(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function formattedNumber(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency ? `${currency} ` : ""}${value.toLocaleString("en-US")}`;
  }
}

function salaryDisplay(job: Record<string, unknown>) {
  const raw = textValue(job.job_salary, 180);
  if (raw) return raw;

  const minimum = numberValue(job.job_min_salary);
  const maximum = numberValue(job.job_max_salary);
  if (minimum === null && maximum === null) return null;

  const currency = textValue(job.job_salary_currency, 8)?.toUpperCase() ?? "USD";
  const period = textValue(job.job_salary_period, 20)?.toLowerCase() ?? "year";
  if (minimum !== null && maximum !== null) {
    return `${formattedNumber(minimum, currency)}–${formattedNumber(maximum, currency)} / ${period}`;
  }
  if (minimum !== null) {
    return `From ${formattedNumber(minimum, currency)} / ${period}`;
  }
  return `Up to ${formattedNumber(maximum as number, currency)} / ${period}`;
}

function parseCandidate(value: unknown, index: number): JobCandidate | null {
  if (!isRecord(value)) return null;

  const title = textValue(value.job_title, 240);
  const applyUrl = safeUrl(value.job_apply_link) ?? safeUrl(value.job_google_link);
  if (!title || !applyUrl) return null;

  const city = textValue(value.job_city, 120);
  const state = textValue(value.job_state, 120);
  const country = textValue(value.job_country, 120);
  const isRemote = value.job_is_remote === true;
  const composedLocation = [city, state, country].filter(Boolean).join(", ");

  return {
    id: textValue(value.job_id, 500) ?? `jsearch-${index}`,
    title,
    company: textValue(value.employer_name, 240) ?? "Company not listed",
    location:
      textValue(value.job_location, 300) ??
      (composedLocation || (isRemote ? "Remote" : "Location not listed")),
    salary: salaryDisplay(value),
    applyUrl,
    postedAt: textValue(value.job_posted_at, 120),
    employmentType: textValue(value.job_employment_type, 80),
    isRemote,
    matchedSkills: [],
    description: textValue(value.job_description, 12_000) ?? "",
    minimumSalary: numberValue(value.job_min_salary),
    maximumSalary: numberValue(value.job_max_salary),
    salaryPeriod: textValue(value.job_salary_period, 20),
    postedTimestamp: numberValue(value.job_posted_at_timestamp),
  };
}

export function parseJSearchResponse(value: unknown): JobCandidate[] {
  if (!isRecord(value)) throw new JSearchResponseError("Invalid JSearch response.");

  const data = value.data;
  const jobs = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.jobs)
      ? data.jobs
      : null;

  if (!jobs) throw new JSearchResponseError("Invalid JSearch response.");
  return jobs
    .map((job, index) => parseCandidate(job, index))
    .filter((job): job is JobCandidate => job !== null);
}

export function buildJSearchQuery(profile: ResumeProfile) {
  const remote = /\bremote\b/i.test(profile.preferences.targetLocation);
  return [
    profile.targetRoles[0],
    "jobs",
    remote ? "remote" : `in ${profile.preferences.targetLocation}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export class JSearchClient {
  constructor(
    private readonly apiKey = process.env.OPENWEBNINJA_API_KEY?.trim(),
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async search(profile: ResumeProfile, signal: AbortSignal): Promise<JobMatch[]> {
    if (!this.apiKey) {
      throw new JSearchConfigurationError("OPENWEBNINJA_API_KEY is not configured.");
    }

    const url = new URL(JSEARCH_ENDPOINT);
    url.searchParams.set("query", buildJSearchQuery(profile));
    url.searchParams.set("country", "us");
    url.searchParams.set("language", "en");
    url.searchParams.set("date_posted", "month");
    if (/\bremote\b/i.test(profile.preferences.targetLocation)) {
      url.searchParams.set("work_from_home", "true");
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
        signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new JSearchProviderError("JSearch request failed.");
    }

    if (!response.ok) {
      throw new JSearchProviderError("JSearch returned an error.", response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new JSearchResponseError("JSearch returned invalid JSON.");
    }

    return rankJobCandidates(parseJSearchResponse(body), profile);
  }
}

export const jSearchClient = new JSearchClient();
