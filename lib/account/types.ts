import type { ResumeProfile } from "@/lib/analysis/types";
import type {
  ApplicationSettings,
  TrackedApplication,
} from "@/lib/applications/types";
import type { PointAccountSnapshot } from "@/lib/points/types";
import type { JobPreferences } from "@/lib/preferences/types";
import type { ResumePrivacySettings } from "@/lib/privacy/types";

export type ResumeMatchDataExport = {
  schemaVersion: 5;
  generatedAt: string;
  data: {
    savedPreferences: JobPreferences | null;
    extractedResumeText: string | null;
    aiCandidateProfile: ResumeProfile | null;
    privacySettings: ResumePrivacySettings;
    points: PointAccountSnapshot;
    applications: TrackedApplication[];
    applicationSettings: ApplicationSettings;
  };
};

export type SendAccountDataResponse = {
  data: { sent: true };
};

export type DeleteAccountDataResponse = {
  data: { deleted: true };
};

export type AccountDataErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "EMAIL_UNAVAILABLE"
  | "DATA_UNAVAILABLE"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "DELETE_UNAVAILABLE";

export type AccountDataErrorResponse = {
  error: {
    code: AccountDataErrorCode;
    message: string;
  };
};
