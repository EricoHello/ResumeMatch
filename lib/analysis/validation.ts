import { parseJobPreferences } from "@/lib/preferences/validation";
import { normalizeResumeText } from "@/lib/resume/text";

import {
  EXPERIENCE_LEVELS,
  type AnalyzeResumeRequest,
  type GeneratedResumeAnalysis,
} from "./types";

export const MIN_RESUME_TEXT_LENGTH = 20;
export const MAX_RESUME_TEXT_LENGTH = 50_000;
export const MAX_ANALYSIS_SUMMARY_LENGTH = 600;
export const MAX_ANALYSIS_SKILLS = 24;
export const MAX_RECENT_JOB_TITLES = 5;
export const MAX_TARGET_ROLES = 6;
export const MAX_SEARCH_KEYWORDS = 16;

const REQUEST_KEYS = ["preferences", "resumeText"];
const GENERATED_ANALYSIS_KEYS = [
  "experienceLevel",
  "recentJobTitles",
  "searchKeywords",
  "skills",
  "summary",
  "targetRoles",
];
const EXPERIENCE_LEVEL_SET = new Set<string>(EXPERIENCE_LEVELS);

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
}

export function parseAnalyzeResumeRequest(value: unknown): AnalyzeResumeRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
    throw new AnalysisValidationError(
      "Include exactly resumeText and preferences.",
    );
  }

  if (typeof value.resumeText !== "string") {
    throw new AnalysisValidationError("Resume text must be a text value.");
  }

  const resumeText = normalizeResumeText(value.resumeText);

  if (resumeText.length < MIN_RESUME_TEXT_LENGTH) {
    throw new AnalysisValidationError(
      "Resume text is too short to analyze. Upload a resume with readable text.",
    );
  }

  if (resumeText.length > MAX_RESUME_TEXT_LENGTH) {
    throw new AnalysisValidationError(
      `Resume text must be ${MAX_RESUME_TEXT_LENGTH.toLocaleString("en-US")} characters or fewer.`,
    );
  }

  try {
    return {
      resumeText,
      preferences: parseJobPreferences(value.preferences),
    };
  } catch {
    throw new AnalysisValidationError(
      "Preferences must include valid locations, radius, job type, and minimum salary.",
    );
  }
}

function parseString(
  value: unknown,
  fieldName: string,
  maximumLength: number,
) {
  if (typeof value !== "string") {
    throw new AnalysisValidationError(`${fieldName} must be text.`);
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new AnalysisValidationError(
      `${fieldName} must contain between 1 and ${maximumLength} characters.`,
    );
  }

  return normalized;
}

function parseStringList(
  value: unknown,
  fieldName: string,
  maximumItems: number,
  maximumItemLength: number,
  minimumItems = 0,
) {
  if (
    !Array.isArray(value) ||
    value.length < minimumItems ||
    value.length > maximumItems
  ) {
    throw new AnalysisValidationError(
      `${fieldName} must be an array with between ${minimumItems} and ${maximumItems} items.`,
    );
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const normalized = parseString(item, `${fieldName} item`, maximumItemLength);
    const comparisonKey = normalized.toLocaleLowerCase("en-US");

    if (!seen.has(comparisonKey)) {
      seen.add(comparisonKey);
      result.push(normalized);
    }
  }

  return result;
}

export function parseGeneratedResumeAnalysis(
  value: unknown,
): GeneratedResumeAnalysis {
  if (!isRecord(value) || !hasExactKeys(value, GENERATED_ANALYSIS_KEYS)) {
    throw new AnalysisValidationError(
      "The generated resume analysis has an unexpected structure.",
    );
  }

  if (
    typeof value.experienceLevel !== "string" ||
    !EXPERIENCE_LEVEL_SET.has(value.experienceLevel)
  ) {
    throw new AnalysisValidationError(
      "The generated experience level is invalid.",
    );
  }

  return {
    summary: parseString(
      value.summary,
      "Generated summary",
      MAX_ANALYSIS_SUMMARY_LENGTH,
    ),
    experienceLevel:
      value.experienceLevel as GeneratedResumeAnalysis["experienceLevel"],
    skills: parseStringList(
      value.skills,
      "Generated skills",
      MAX_ANALYSIS_SKILLS,
      100,
    ),
    recentJobTitles: parseStringList(
      value.recentJobTitles,
      "Generated recent job titles",
      MAX_RECENT_JOB_TITLES,
      160,
    ),
    targetRoles: parseStringList(
      value.targetRoles,
      "Generated target roles",
      MAX_TARGET_ROLES,
      160,
      1,
    ),
    searchKeywords: parseStringList(
      value.searchKeywords,
      "Generated search keywords",
      MAX_SEARCH_KEYWORDS,
      120,
      1,
    ),
  };
}
