import type { User } from "firebase/auth";

import type { ResumePrivacyStatus } from "./types";

export class ResumePrivacyClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumePrivacyClientError";
  }
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return fallback;
    }

    const error = body.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  } catch {
    // Empty and non-JSON responses use the fallback.
  }

  return fallback;
}

function parsePrivacyResponse(body: unknown): ResumePrivacyStatus | undefined {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return undefined;
  }

  const data = body.data;
  if (typeof data !== "object" || data === null || !("privacy" in data)) {
    return undefined;
  }

  const privacy = data.privacy;
  if (
    typeof privacy !== "object" ||
    privacy === null ||
    !("saveResumeData" in privacy) ||
    typeof privacy.saveResumeData !== "boolean" ||
    !("hasSavedResumeData" in privacy) ||
    typeof privacy.hasSavedResumeData !== "boolean"
  ) {
    return undefined;
  }

  return {
    saveResumeData: privacy.saveResumeData,
    hasSavedResumeData: privacy.hasSavedResumeData,
  };
}

async function authenticatedRequest(
  user: User,
  method: "GET" | "PUT",
  signal: AbortSignal,
  saveResumeData?: boolean,
) {
  const token = await user.getIdToken(true);
  if (signal.aborted) throw signal.reason;

  const response = await fetch("/api/account/privacy", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "PUT" ? { body: JSON.stringify({ saveResumeData }) } : {}),
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new ResumePrivacyClientError(
      await responseMessage(
        response,
        method === "GET"
          ? "We couldn’t load your resume privacy setting. Please try again."
          : "We couldn’t update your resume privacy setting. Please try again.",
      ),
    );
  }

  const privacy = parsePrivacyResponse(await response.json());
  if (!privacy) {
    throw new ResumePrivacyClientError(
      "The server returned an unexpected privacy-setting response.",
    );
  }

  return privacy;
}

export function loadResumePrivacySettings(
  user: User,
  signal: AbortSignal,
): Promise<ResumePrivacyStatus> {
  return authenticatedRequest(user, "GET", signal);
}

export function saveResumePrivacySettings(
  user: User,
  saveResumeData: boolean,
  signal: AbortSignal,
): Promise<ResumePrivacyStatus> {
  return authenticatedRequest(user, "PUT", signal, saveResumeData);
}
