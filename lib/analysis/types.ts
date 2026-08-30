import type { JobPreferences } from "@/lib/preferences/types";
import type { ParsedResume } from "@/lib/resume/types";

/**
 * The complete, non-AI intake payload that a future analysis layer can consume.
 * Creating this object does not persist it or invoke a model.
 */
export type ResumeAnalysisInput = {
  resume: ParsedResume;
  preferences: JobPreferences;
};
