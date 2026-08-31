import type { User } from "firebase/auth";

import type { SavedResume } from "./saved-types";
import { parseSavedResume } from "./saved-validation";

export class SavedResumeClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedResumeClientError";
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

function parseResponse(body: unknown): SavedResume | null | undefined {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return undefined;
  }
  const data = body.data;
  if (typeof data !== "object" || data === null || !("savedResume" in data)) {
    return undefined;
  }
  if (data.savedResume === null) return null;

  try {
    return parseSavedResume(data.savedResume);
  } catch {
    return undefined;
  }
}

export async function loadSavedResume(
  user: User,
  signal: AbortSignal,
): Promise<SavedResume | null> {
  const token = await user.getIdToken(true);
  if (signal.aborted) throw signal.reason;

  const response = await fetch("/api/resumes/saved", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new SavedResumeClientError(
      await responseMessage(
        response,
        "We couldn’t load your saved resume. You can retry or upload a new one.",
      ),
    );
  }

  const savedResume = parseResponse(await response.json());
  if (savedResume === undefined) {
    throw new SavedResumeClientError(
      "The server returned an unexpected saved-resume response.",
    );
  }
  return savedResume;
}

export async function saveSavedResume(
  user: User,
  savedResume: SavedResume,
  signal: AbortSignal,
): Promise<SavedResume> {
  const normalized = parseSavedResume(savedResume);
  const token = await user.getIdToken(true);
  if (signal.aborted) throw signal.reason;

  const response = await fetch("/api/resumes/saved", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(normalized),
    signal,
  });
  if (!response.ok) {
    throw new SavedResumeClientError(
      await responseMessage(
        response,
        "We couldn’t save your resume. Please try again.",
      ),
    );
  }

  const storedResume = parseResponse(await response.json());
  if (!storedResume) {
    throw new SavedResumeClientError(
      "The server returned an unexpected saved-resume response.",
    );
  }
  return storedResume;
}
