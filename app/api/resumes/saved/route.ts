import { NextResponse } from "next/server";

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";
import { savedResumeRepository } from "@/lib/resume/saved-repository";
import type {
  GetSavedResumeResponse,
  SavedResumeErrorCode,
  SavedResumeErrorResponse,
  SaveSavedResumeResponse,
} from "@/lib/resume/saved-types";
import {
  parseSavedResume,
  SavedResumeValidationError,
} from "@/lib/resume/saved-validation";

export const runtime = "nodejs";
export const MAX_SAVED_RESUME_REQUEST_BYTES = 128 * 1024;

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

function errorResponse(
  code: SavedResumeErrorCode,
  message: string,
  status: number,
) {
  const body: SavedResumeErrorResponse = { error: { code, message } };
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

async function authenticatedUserId(request: Request) {
  try {
    return {
      status: "authenticated" as const,
      userId: await authenticateFirebaseRequest(request),
    };
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return { status: "required" as const };
    }
    return { status: "unavailable" as const };
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SAVED_RESUME_REQUEST_BYTES
  ) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) throw new InvalidRequestBodyError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_SAVED_RESUME_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new InvalidRequestBodyError();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new InvalidRequestBodyError();
  }
}

function authenticationError(
  authentication: Awaited<ReturnType<typeof authenticatedUserId>>,
  operation: "load" | "save",
) {
  if (authentication.status === "required") {
    return errorResponse(
      "AUTH_REQUIRED",
      `Sign in to ${operation} your saved resume.`,
      401,
    );
  }
  if (authentication.status === "unavailable") {
    return errorResponse(
      "AUTH_UNAVAILABLE",
      "We couldn't verify your sign-in right now. Please try again.",
      503,
    );
  }
  return null;
}

export async function GET(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication, "load");
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to load your saved resume.", 401);
  }

  try {
    const savedResume = await savedResumeRepository.get(authentication.userId);
    const body: GetSavedResumeResponse = { data: { savedResume } };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "SAVED_RESUME_UNAVAILABLE",
      "We couldn't load your saved resume. You can retry or upload a new one.",
      503,
    );
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication, "save");
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to save your resume.", 401);
  }

  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
    "";
  if (mediaType !== "application/json") {
    return errorResponse("INVALID_REQUEST", "Send the saved resume as JSON.", 400);
  }

  let requestBody: unknown;
  try {
    requestBody = await readBoundedJson(request);
  } catch (error) {
    return errorResponse(
      "INVALID_REQUEST",
      error instanceof RequestBodyTooLargeError
        ? "The saved resume request is too large."
        : "The request body must contain valid JSON.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  let savedResume;
  try {
    savedResume = parseSavedResume(requestBody);
  } catch (error) {
    return errorResponse(
      "INVALID_SAVED_RESUME",
      error instanceof SavedResumeValidationError
        ? error.message
        : "The saved resume is invalid.",
      422,
    );
  }

  try {
    const storedResume = await savedResumeRepository.save(
      authentication.userId,
      savedResume,
    );
    const body: SaveSavedResumeResponse = {
      data: { savedResume: storedResume },
    };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "SAVED_RESUME_UNAVAILABLE",
      "We couldn't save your resume. Please try again.",
      503,
    );
  }
}
