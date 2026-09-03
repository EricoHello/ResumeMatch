import {
  APPLICATION_STATUSES,
  AUTO_ARCHIVE_DAY_OPTIONS,
  type ApplicationArchiveReason,
  type ApplicationOrigin,
  type ApplicationSettings,
  type ApplicationStatus,
  type ApplicationUpdates,
  type CreateApplicationInput,
  type TrackedApplication,
} from "./types";

const CREATE_KEYS = [
  "appliedDate",
  "company",
  "jobUrl",
  "location",
  "nextAction",
  "nextActionDate",
  "notes",
  "origin",
  "salary",
  "source",
  "sourceJobId",
  "status",
  "title",
] as const;
const UPDATE_KEYS = [
  "appliedDate",
  "nextAction",
  "nextActionDate",
  "notes",
  "status",
] as const;

export const APPLICATION_LIMITS = {
  title: 240,
  company: 240,
  location: 300,
  salary: 180,
  jobUrl: 2_000,
  source: 120,
  sourceJobId: 500,
  notes: 5_000,
  nextAction: 500,
} as const;

export class ApplicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function requiredText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") {
    throw new ApplicationValidationError(`${label} must be a text value.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ApplicationValidationError(
      `${label} must be between 1 and ${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number) {
  if (value === null) return null;
  return requiredText(value, label, maximum);
}

function notesText(value: unknown) {
  if (typeof value !== "string") {
    throw new ApplicationValidationError("Notes must be a text value.");
  }
  const normalized = value.trim();
  if (normalized.length > APPLICATION_LIMITS.notes) {
    throw new ApplicationValidationError(
      `Notes cannot exceed ${APPLICATION_LIMITS.notes} characters.`,
    );
  }
  return normalized;
}

function statusValue(value: unknown): ApplicationStatus {
  if (
    typeof value !== "string" ||
    !APPLICATION_STATUSES.includes(value as ApplicationStatus)
  ) {
    throw new ApplicationValidationError(
      `Status must be one of: ${APPLICATION_STATUSES.join(", ")}.`,
    );
  }
  return value as ApplicationStatus;
}

function originValue(value: unknown): ApplicationOrigin {
  if (value !== "resumematch" && value !== "manual") {
    throw new ApplicationValidationError(
      "Application origin must be resumematch or manual.",
    );
  }
  return value;
}

function urlValue(value: unknown) {
  if (value === null) return null;
  const raw = requiredText(value, "Job URL", APPLICATION_LIMITS.jobUrl);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new ApplicationValidationError(
      "Job URL must be a valid HTTP or HTTPS URL.",
    );
  }
}

function dateValue(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApplicationValidationError(`${label} must use YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ApplicationValidationError(`${label} must be a real calendar date.`);
  }
  return value;
}

function timestampValue(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ApplicationValidationError(`${label} must be an ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

function optionalTimestampValue(value: unknown, label: string) {
  return value === null ? null : timestampValue(value, label);
}

function archiveReasonValue(value: unknown): ApplicationArchiveReason | null {
  if (value === null) return null;
  if (value !== "manual" && value !== "inactivity") {
    throw new ApplicationValidationError("Archive reason is invalid.");
  }
  return value;
}

export function parseApplicationSettings(value: unknown): ApplicationSettings {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !("autoArchiveDays" in value)
  ) {
    throw new ApplicationValidationError(
      "Include exactly the autoArchiveDays setting.",
    );
  }
  if (value.autoArchiveDays === null) return { autoArchiveDays: null };
  if (
    typeof value.autoArchiveDays !== "number" ||
    !AUTO_ARCHIVE_DAY_OPTIONS.includes(
      value.autoArchiveDays as (typeof AUTO_ARCHIVE_DAY_OPTIONS)[number],
    )
  ) {
    throw new ApplicationValidationError(
      "Auto-archive must be 14, 30, 60, or 90 days, or Never.",
    );
  }
  return {
    autoArchiveDays: value.autoArchiveDays as Exclude<
      ApplicationSettings["autoArchiveDays"],
      null
    >,
  };
}

export function parseCreateApplication(value: unknown): CreateApplicationInput {
  if (!isRecord(value) || !hasExactKeys(value, CREATE_KEYS)) {
    throw new ApplicationValidationError(
      "Include exactly the supported application fields.",
    );
  }

  return {
    title: requiredText(value.title, "Job title", APPLICATION_LIMITS.title),
    company: requiredText(value.company, "Company", APPLICATION_LIMITS.company),
    location: requiredText(value.location, "Location", APPLICATION_LIMITS.location),
    salary: optionalText(value.salary, "Salary", APPLICATION_LIMITS.salary),
    jobUrl: urlValue(value.jobUrl),
    source: requiredText(value.source, "Source", APPLICATION_LIMITS.source),
    sourceJobId: optionalText(
      value.sourceJobId,
      "Source job ID",
      APPLICATION_LIMITS.sourceJobId,
    ),
    origin: originValue(value.origin),
    status: statusValue(value.status),
    appliedDate: dateValue(value.appliedDate, "Applied date"),
    notes: notesText(value.notes),
    nextAction: optionalText(
      value.nextAction,
      "Next action",
      APPLICATION_LIMITS.nextAction,
    ),
    nextActionDate: dateValue(value.nextActionDate, "Next action date"),
  };
}

export function parseApplicationUpdates(value: unknown): ApplicationUpdates {
  if (!isRecord(value)) {
    throw new ApplicationValidationError("Application updates must be a JSON object.");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length === 0 ||
    keys.some((key) => !UPDATE_KEYS.includes(key as (typeof UPDATE_KEYS)[number]))
  ) {
    throw new ApplicationValidationError(
      "Update one or more supported application fields.",
    );
  }

  const updates: ApplicationUpdates = {};
  if ("status" in value) updates.status = statusValue(value.status);
  if ("appliedDate" in value) {
    updates.appliedDate = dateValue(value.appliedDate, "Applied date");
  }
  if ("notes" in value) updates.notes = notesText(value.notes);
  if ("nextAction" in value) {
    updates.nextAction = optionalText(
      value.nextAction,
      "Next action",
      APPLICATION_LIMITS.nextAction,
    );
  }
  if ("nextActionDate" in value) {
    updates.nextActionDate = dateValue(value.nextActionDate, "Next action date");
  }
  return updates;
}

export function parseApplicationId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 150 ||
    value.includes("/")
  ) {
    throw new ApplicationValidationError("Application ID is invalid.");
  }
  return value;
}

export function parseTrackedApplication(value: unknown): TrackedApplication {
  if (!isRecord(value)) {
    throw new ApplicationValidationError("Application must be a JSON object.");
  }
  const archived = value.archived;
  if (typeof archived !== "boolean") {
    throw new ApplicationValidationError("Archived state must be a Boolean.");
  }
  const archivedAt = optionalTimestampValue(value.archivedAt, "Archived at");
  const archiveReason = archiveReasonValue(value.archiveReason);
  if (
    (archived && (archivedAt === null || archiveReason === null)) ||
    (!archived && (archivedAt !== null || archiveReason !== null))
  ) {
    throw new ApplicationValidationError("Archived state is inconsistent.");
  }

  return {
    id: parseApplicationId(value.id),
    ...parseCreateApplication({
      title: value.title,
      company: value.company,
      location: value.location,
      salary: value.salary,
      jobUrl: value.jobUrl,
      source: value.source,
      sourceJobId: value.sourceJobId,
      origin: value.origin,
      status: value.status,
      appliedDate: value.appliedDate,
      notes: value.notes,
      nextAction: value.nextAction,
      nextActionDate: value.nextActionDate,
    }),
    dateAdded: timestampValue(value.dateAdded, "Date added"),
    lastUpdated: timestampValue(value.lastUpdated, "Last updated"),
    lastActivityAt: timestampValue(value.lastActivityAt, "Last activity"),
    archived,
    archivedAt,
    archiveReason,
  };
}
