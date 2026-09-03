import type { ResumeProfile } from "@/lib/analysis/types";
import { parseGeneratedResumeAnalysis } from "@/lib/analysis/validation";
import { parseJobPreferences } from "@/lib/preferences/validation";

import type { SearchJobsRequest } from "./types";

const REQUEST_KEYS = ["profile"];
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

export class JobSearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobSearchValidationError";
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

export function parseSearchJobsRequest(value: unknown): SearchJobsRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
    throw new JobSearchValidationError("Include exactly the candidate profile.");
  }

  if (!isRecord(value.profile) || !hasExactKeys(value.profile, PROFILE_KEYS)) {
    throw new JobSearchValidationError("The candidate profile is invalid.");
  }

  try {
    const generated = parseGeneratedResumeAnalysis({
      summary: value.profile.summary,
      resumeImprovement: value.profile.resumeImprovement,
      experienceLevel: value.profile.experienceLevel,
      skills: value.profile.skills,
      recentJobTitles: value.profile.recentJobTitles,
      targetRoles: value.profile.targetRoles,
      searchKeywords: value.profile.searchKeywords,
    });
    const preferences = parseJobPreferences(value.profile.preferences);
    const profile: ResumeProfile = { ...generated, preferences };
    return { profile };
  } catch {
    throw new JobSearchValidationError("The candidate profile is invalid.");
  }
}
