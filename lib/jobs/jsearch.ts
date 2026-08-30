import "server-only";

import type { ResumeProfile } from "@/lib/analysis/types";

import { rankJobCandidatesWithDiagnostics } from "./ranking";
import type { JobCandidate, JobMatch } from "./types";

const JSEARCH_ENDPOINT = "https://api.openwebninja.com/jsearch/search-v2";
const SEARCH_TIMEOUT_MS = 30_000;

type JobSearchLogger = {
  info: (message: string, data: unknown) => void;
};

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
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

function applyOptionUrl(value: unknown) {
  if (!Array.isArray(value)) return null;
  const options = value.filter(isRecord);
  const direct = options.find((option) => option.is_direct === true);
  return (
    safeUrl(direct?.apply_link) ??
    options.map((option) => safeUrl(option.apply_link)).find(Boolean) ??
    null
  );
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
  const applyUrl =
    safeUrl(value.job_apply_link) ??
    applyOptionUrl(value.apply_options) ??
    safeUrl(value.job_google_link);
  if (!title || !applyUrl) return null;

  const city = textValue(value.job_city, 120);
  const state = textValue(value.job_state, 120);
  const country = textValue(value.job_country, 120);
  const isRemote =
    value.job_is_remote === true ||
    /\bremote\b/i.test(textValue(value.work_arrangement, 80) ?? "");
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
    employmentType:
      textValue(value.job_employment_type, 80) ??
      (Array.isArray(value.job_employment_types)
        ? textValue(value.job_employment_types[0], 80)
        : null),
    isRemote,
    matchedSkills: [],
    description: textValue(value.job_description, 12_000) ?? "",
    minimumSalary: numberValue(value.job_min_salary),
    maximumSalary: numberValue(value.job_max_salary),
    salaryPeriod: textValue(value.job_salary_period, 20),
    postedTimestamp: numberValue(value.job_posted_at_timestamp),
  };
}

export function parseJSearchResponseWithDiagnostics(value: unknown) {
  if (!isRecord(value)) throw new JSearchResponseError("Invalid JSearch response.");

  const data = value.data;
  const jobs = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.jobs)
      ? data.jobs
      : null;

  if (!jobs) throw new JSearchResponseError("Invalid JSearch response.");
  const candidates = jobs
    .map((job, index) => parseCandidate(job, index))
    .filter((job): job is JobCandidate => job !== null);
  return { rawJobCount: jobs.length, candidates };
}

export function parseJSearchResponse(value: unknown): JobCandidate[] {
  return parseJSearchResponseWithDiagnostics(value).candidates;
}

function cleanQueryPart(value: string, maximumLength: number) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength)
    .trim();
}

function broadPrimaryRole(value: string) {
  const cleaned = cleanQueryPart(value, 100)
    .replace(/\s+(?:\/|\||or)\s+.*$/i, "")
    .replace(/\s+[–—:-]\s+.*$/, "")
    .trim();
  const commaIndex = cleaned.indexOf(",");
  if (commaIndex > 0) {
    const beforeComma = cleaned.slice(0, commaIndex).trim();
    if (beforeComma.split(/\s+/).length >= 2) return beforeComma;
  }
  return cleaned.replaceAll(",", " ").replace(/\s+/g, " ").trim();
}

function strongestSearchKeyword(profile: ResumeProfile, role: string) {
  const roleWords = new Set(role.toLowerCase().split(/\s+/));
  for (const keyword of profile.searchKeywords) {
    const cleaned = cleanQueryPart(keyword, 60)
      .replace(/\b(?:AND|OR|NOT)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    const words = cleaned.toLowerCase().split(/\s+/).slice(0, 4);
    if (words.every((word) => roleWords.has(word))) continue;
    return words.join(" ");
  }
  return "";
}

export function jSearchLocaleFor(location: string) {
  const normalized = location.toLowerCase();
  const rules: Array<[RegExp, string, string]> = [
    [/\b(?:united kingdom|england|scotland|wales|london|uk)\b/, "gb", "en"],
    [/\b(?:canada|toronto|vancouver|montreal)\b/, "ca", "en"],
    [/\b(?:australia|sydney|melbourne)\b/, "au", "en"],
    [/\b(?:germany|berlin|munich)\b/, "de", "de"],
    [/\b(?:france|paris)\b/, "fr", "fr"],
    [/\b(?:spain|madrid|barcelona)\b/, "es", "es"],
  ];
  const match = rules.find(([pattern]) => pattern.test(normalized));
  return match ? { country: match[1], language: match[2] } : { country: "us", language: "en" };
}

export function buildJSearchQuery(profile: ResumeProfile) {
  const role = broadPrimaryRole(profile.targetRoles[0]);
  const keyword = strongestSearchKeyword(profile, role);
  const location = cleanQueryPart(profile.preferences.targetLocation, 120);
  const remote = /\bremote\b/i.test(profile.preferences.targetLocation);
  return [
    role,
    keyword,
    "jobs",
    remote ? "remote" : `in ${location}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export class JSearchClient {
  constructor(
    private readonly apiKey = process.env.OPENWEBNINJA_API_KEY?.trim(),
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly logger: JobSearchLogger = console,
  ) {}

  private debug(message: string, data: unknown) {
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.JOB_SEARCH_DEBUG === "true"
    ) {
      this.logger.info(`[ResumeMatch job search] ${message}`, data);
    }
  }

  async search(profile: ResumeProfile, signal: AbortSignal): Promise<JobMatch[]> {
    if (!this.apiKey) {
      throw new JSearchConfigurationError("OPENWEBNINJA_API_KEY is not configured.");
    }

    const query = buildJSearchQuery(profile);
    const locale = jSearchLocaleFor(profile.preferences.targetLocation);
    const url = new URL(JSEARCH_ENDPOINT);
    url.searchParams.set("query", query);
    url.searchParams.set("country", locale.country);
    url.searchParams.set("language", locale.language);
    this.debug("generated JSearch query", query);

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

    const parsed = parseJSearchResponseWithDiagnostics(body);
    this.debug("number of raw jobs returned", parsed.rawJobCount);
    this.debug("number usable after field normalization", parsed.candidates.length);

    const ranked = rankJobCandidatesWithDiagnostics(parsed.candidates, profile);
    this.debug("number remaining after filtering", ranked.remainingAfterFiltering);
    this.debug("top ranked scores/titles", ranked.topRanked);
    return ranked.jobs;
  }
}

export const jSearchClient = new JSearchClient();
