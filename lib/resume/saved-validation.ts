import { parseGeneratedResumeAnalysis } from "@/lib/analysis/validation";
import type { ResumeProfile } from "@/lib/analysis/types";
import { parseJobPreferences } from "@/lib/preferences/validation";
import { normalizeResumeText } from "@/lib/resume/text";

import type { SavedResume } from "./saved-types";

export const MIN_SAVED_RESUME_TEXT_LENGTH = 20;
export const MAX_SAVED_RESUME_TEXT_LENGTH = 50_000;

const SAVED_RESUME_KEYS = ["profile", "resumeText"];
const PROFILE_KEYS = [
  "experienceLevel",
  "preferences",
  "recentJobTitles",
  "resumeImprovement",
  "searchKeywords",
  "skills",
  "summary",
  "targetRoles",
];

export class SavedResumeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedResumeValidationError";
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

function parseProfile(value: unknown): ResumeProfile {
  if (!isRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
    throw new SavedResumeValidationError(
      "The saved candidate profile has an unexpected structure.",
    );
  }

  try {
    return {
      ...parseGeneratedResumeAnalysis({
        summary: value.summary,
        resumeImprovement: value.resumeImprovement,
        experienceLevel: value.experienceLevel,
        skills: value.skills,
        recentJobTitles: value.recentJobTitles,
        targetRoles: value.targetRoles,
        searchKeywords: value.searchKeywords,
      }),
      preferences: parseJobPreferences(value.preferences),
    };
  } catch {
    throw new SavedResumeValidationError(
      "The saved candidate profile is invalid.",
    );
  }
}

export function parseSavedResume(value: unknown): SavedResume {
  if (!isRecord(value) || !hasExactKeys(value, SAVED_RESUME_KEYS)) {
    throw new SavedResumeValidationError(
      "Include exactly resumeText and profile.",
    );
  }

  if (typeof value.resumeText !== "string") {
    throw new SavedResumeValidationError("Resume text must be a text value.");
  }

  const resumeText = normalizeResumeText(value.resumeText);
  if (
    resumeText.length < MIN_SAVED_RESUME_TEXT_LENGTH ||
    resumeText.length > MAX_SAVED_RESUME_TEXT_LENGTH
  ) {
    throw new SavedResumeValidationError(
      `Resume text must contain between ${MIN_SAVED_RESUME_TEXT_LENGTH} and ${MAX_SAVED_RESUME_TEXT_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }

  return {
    resumeText,
    profile: value.profile === null ? null : parseProfile(value.profile),
  };
}
