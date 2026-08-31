import type { ResumeProfile } from "@/lib/analysis/types";

export type SavedResume = {
  resumeText: string;
  profile: ResumeProfile | null;
};

export type GetSavedResumeResponse = {
  data: {
    savedResume: SavedResume | null;
  };
};

export type SaveSavedResumeResponse = {
  data: {
    savedResume: SavedResume;
  };
};

export type SavedResumeErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_SAVED_RESUME"
  | "SAVED_RESUME_UNAVAILABLE";

export type SavedResumeErrorResponse = {
  error: {
    code: SavedResumeErrorCode;
    message: string;
  };
};
