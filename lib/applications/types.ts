export const APPLICATION_STATUSES = [
  "Applying",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ApplicationOrigin = "resumematch" | "manual";
export type ApplicationArchiveReason = "manual" | "inactivity";

export const AUTO_ARCHIVE_DAY_OPTIONS = [14, 30, 60, 90] as const;
export type AutoArchiveDays = (typeof AUTO_ARCHIVE_DAY_OPTIONS)[number] | null;

export type ApplicationSettings = {
  autoArchiveDays: AutoArchiveDays;
};

export type TrackedApplication = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  jobUrl: string | null;
  source: string;
  sourceJobId: string | null;
  origin: ApplicationOrigin;
  status: ApplicationStatus;
  dateAdded: string;
  appliedDate: string | null;
  lastUpdated: string;
  lastActivityAt: string;
  notes: string;
  nextAction: string | null;
  nextActionDate: string | null;
  archived: boolean;
  archivedAt: string | null;
  archiveReason: ApplicationArchiveReason | null;
};

export type CreateApplicationInput = Pick<
  TrackedApplication,
  | "title"
  | "company"
  | "location"
  | "salary"
  | "jobUrl"
  | "source"
  | "sourceJobId"
  | "origin"
  | "status"
  | "appliedDate"
  | "notes"
  | "nextAction"
  | "nextActionDate"
>;

export type ApplicationUpdates = Partial<
  Pick<
    TrackedApplication,
    "status" | "appliedDate" | "notes" | "nextAction" | "nextActionDate"
  >
>;

export type CreateApplicationResult = {
  application: TrackedApplication;
  created: boolean;
};

export type GetApplicationsResponse = {
  data: { applications: TrackedApplication[] };
};

export type CreateApplicationResponse = {
  data: CreateApplicationResult;
};

export type UpdateApplicationResponse = {
  data: { application: TrackedApplication };
};

export type DeleteApplicationResponse = {
  data: { deleted: true; applicationId: string };
};

export type GetApplicationSettingsResponse = {
  data: { settings: ApplicationSettings };
};

export type SaveApplicationSettingsResponse = GetApplicationSettingsResponse;

export type ApplicationsErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_APPLICATION"
  | "INVALID_SETTINGS"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATIONS_UNAVAILABLE";

export type ApplicationsErrorResponse = {
  error: {
    code: ApplicationsErrorCode;
    message: string;
  };
};
