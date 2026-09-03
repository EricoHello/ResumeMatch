import type { User } from "firebase/auth";

import type { JobMatch } from "@/lib/jobs/types";

import type {
  ApplicationSettings,
  ApplicationUpdates,
  CreateApplicationInput,
  CreateApplicationResult,
  TrackedApplication,
} from "./types";
import {
  parseApplicationSettings,
  parseApplicationUpdates,
  parseCreateApplication,
  parseTrackedApplication,
} from "./validation";

export class ApplicationsClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApplicationsClientError";
  }
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    // Use the stable fallback for empty or malformed responses.
  }
  return fallback;
}

async function authorizedHeaders(user: User, json = false) {
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function responseApplication(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("application" in value.data)
  ) {
    return null;
  }
  try {
    return parseTrackedApplication(value.data.application);
  } catch {
    return null;
  }
}

export async function loadApplications(
  user: User,
  signal?: AbortSignal,
): Promise<TrackedApplication[]> {
  const response = await fetch("/api/applications", {
    headers: await authorizedHeaders(user),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't load your applications. Please try again.",
      ),
      response.status,
    );
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    typeof body.data !== "object" ||
    body.data === null ||
    !("applications" in body.data) ||
    !Array.isArray(body.data.applications)
  ) {
    throw new ApplicationsClientError(
      "The server returned an unexpected applications response.",
      500,
    );
  }

  try {
    return body.data.applications.map(parseTrackedApplication);
  } catch {
    throw new ApplicationsClientError(
      "The server returned an unexpected applications response.",
      500,
    );
  }
}

export async function createApplication(
  user: User,
  input: CreateApplicationInput,
  signal?: AbortSignal,
): Promise<CreateApplicationResult> {
  const normalized = parseCreateApplication(input);
  const response = await fetch("/api/applications", {
    method: "POST",
    headers: await authorizedHeaders(user, true),
    body: JSON.stringify(normalized),
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't add this application. Please try again.",
      ),
      response.status,
    );
  }

  const body: unknown = await response.json();
  const application = responseApplication(body);
  const created =
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    typeof body.data === "object" &&
    body.data !== null &&
    "created" in body.data &&
    typeof body.data.created === "boolean"
      ? body.data.created
      : null;
  if (!application || created === null) {
    throw new ApplicationsClientError(
      "The server returned an unexpected application response.",
      500,
    );
  }
  return { application, created };
}

export async function updateApplication(
  user: User,
  applicationId: string,
  updates: ApplicationUpdates,
  signal?: AbortSignal,
): Promise<TrackedApplication> {
  const normalized = parseApplicationUpdates(updates);
  const response = await fetch("/api/applications", {
    method: "PATCH",
    headers: await authorizedHeaders(user, true),
    body: JSON.stringify({ applicationId, updates: normalized }),
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't update this application. Please try again.",
      ),
      response.status,
    );
  }

  const application = responseApplication(await response.json());
  if (!application) {
    throw new ApplicationsClientError(
      "The server returned an unexpected application response.",
      500,
    );
  }
  return application;
}

export async function setApplicationArchived(
  user: User,
  applicationId: string,
  archived: boolean,
  signal?: AbortSignal,
): Promise<TrackedApplication> {
  const response = await fetch("/api/applications", {
    method: "PATCH",
    headers: await authorizedHeaders(user, true),
    body: JSON.stringify({ applicationId, archived }),
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        `We couldn't ${archived ? "archive" : "restore"} this application. Please try again.`,
      ),
      response.status,
    );
  }
  const application = responseApplication(await response.json());
  if (!application) {
    throw new ApplicationsClientError(
      "The server returned an unexpected application response.",
      500,
    );
  }
  return application;
}

export async function deleteApplication(
  user: User,
  applicationId: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/applications", {
    method: "DELETE",
    headers: await authorizedHeaders(user, true),
    body: JSON.stringify({ applicationId }),
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't delete this application. Please try again.",
      ),
      response.status,
    );
  }
}

function responseSettings(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("settings" in value.data)
  ) {
    return null;
  }
  try {
    return parseApplicationSettings(value.data.settings);
  } catch {
    return null;
  }
}

export async function loadApplicationSettings(
  user: User,
  signal?: AbortSignal,
): Promise<ApplicationSettings> {
  const response = await fetch("/api/applications/settings", {
    headers: await authorizedHeaders(user),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't load application settings. Please try again.",
      ),
      response.status,
    );
  }
  const settings = responseSettings(await response.json());
  if (!settings) {
    throw new ApplicationsClientError(
      "The server returned an unexpected application settings response.",
      500,
    );
  }
  return settings;
}

export async function saveApplicationSettings(
  user: User,
  settings: ApplicationSettings,
  signal?: AbortSignal,
): Promise<ApplicationSettings> {
  const normalized = parseApplicationSettings(settings);
  const response = await fetch("/api/applications/settings", {
    method: "PUT",
    headers: await authorizedHeaders(user, true),
    body: JSON.stringify(normalized),
    signal,
  });
  if (!response.ok) {
    throw new ApplicationsClientError(
      await responseMessage(
        response,
        "We couldn't save application settings. Please try again.",
      ),
      response.status,
    );
  }
  const saved = responseSettings(await response.json());
  if (!saved) {
    throw new ApplicationsClientError(
      "The server returned an unexpected application settings response.",
      500,
    );
  }
  return saved;
}

export function trackResumeMatchJob(user: User, job: JobMatch) {
  return createApplication(user, {
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    jobUrl: job.applyUrl,
    source: "JSearch",
    sourceJobId: job.id,
    origin: "resumematch",
    status: "Applying",
    appliedDate: null,
    notes: "",
    nextAction: null,
    nextActionDate: null,
  });
}
