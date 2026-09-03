import type { JobPreferences } from "@/lib/preferences/types";
import type { ParsedResume } from "@/lib/resume/types";

export const EXPERIENCE_LEVELS = [
  "entry",
  "mid",
  "senior",
  "lead",
  "executive",
  "unknown",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/**
 * The complete intake payload assembled by the client before analysis.
 * Creating this object does not persist it or invoke a model by itself.
 */
export type ResumeAnalysisInput = {
  resume: ParsedResume;
  preferences: JobPreferences;
};

export type AnalyzeResumeRequest = {
  resumeText: string;
  preferences: JobPreferences;
};

export type GeneratedResumeAnalysis = {
  summary: string;
  resumeImprovement: string;
  experienceLevel: ExperienceLevel;
  skills: string[];
  recentJobTitles: string[];
  targetRoles: string[];
  searchKeywords: string[];
};

export type ResumeProfile = GeneratedResumeAnalysis & {
  preferences: JobPreferences;
};

export type AnalyzeResumeSuccessResponse = {
  profile: ResumeProfile;
};

export type AnalyzeResumeErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "INVALID_ANALYSIS_INPUT"
  | "RATE_LIMITED"
  | "ANALYSIS_UNAVAILABLE"
  | "ANALYSIS_FAILED";

export type AnalyzeResumeErrorResponse = {
  error: {
    code: AnalyzeResumeErrorCode;
    message: string;
  };
};
