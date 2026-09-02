import { NextResponse } from "next/server";

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";
import { resumePrivacyRepository } from "@/lib/privacy/repository";
import type {
  GetResumePrivacyResponse,
  ResumePrivacyErrorCode,
  ResumePrivacyErrorResponse,
  SaveResumePrivacyResponse,
} from "@/lib/privacy/types";
import { savedResumeRepository } from "@/lib/resume/saved-repository";

export const runtime = "nodejs";
export const MAX_PRIVACY_REQUEST_BYTES = 1_024;

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(
  code: ResumePrivacyErrorCode,
  message: string,
  status: number,
) {
  const body: ResumePrivacyErrorResponse = { error: { code, message } };
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

function authenticationError(
  authentication: Awaited<ReturnType<typeof authenticatedUserId>>,
) {
  if (authentication.status === "required") {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to manage your resume privacy setting.",
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

async function privacyStatus(userId: string) {
  const [settings, hasSavedResumeData] = await Promise.all([
    resumePrivacyRepository.get(userId),
    savedResumeRepository.exists(userId),
  ]);

  return { ...settings, hasSavedResumeData };
}

export async function GET(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to manage privacy.", 401);
  }

  try {
    const body: GetResumePrivacyResponse = {
      data: { privacy: await privacyStatus(authentication.userId) },
    };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "PRIVACY_UNAVAILABLE",
      "We couldn't load your resume privacy setting. Please try again.",
      503,
    );
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to manage privacy.", 401);
  }

  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
    "";
  if (mediaType !== "application/json") {
    return errorResponse(
      "INVALID_REQUEST",
      "Send the resume privacy setting as JSON.",
      400,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PRIVACY_REQUEST_BYTES
  ) {
    return errorResponse("INVALID_REQUEST", "The request is too large.", 413);
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain valid JSON.",
      400,
    );
  }

  if (
    typeof requestBody !== "object" ||
    requestBody === null ||
    Array.isArray(requestBody) ||
    Object.keys(requestBody).length !== 1 ||
    !("saveResumeData" in requestBody) ||
    typeof requestBody.saveResumeData !== "boolean"
  ) {
    return errorResponse(
      "INVALID_PRIVACY_SETTING",
      "Include exactly one true or false saveResumeData setting.",
      422,
    );
  }

  try {
    await resumePrivacyRepository.save(authentication.userId, {
      saveResumeData: requestBody.saveResumeData,
    });
    const body: SaveResumePrivacyResponse = {
      data: { privacy: await privacyStatus(authentication.userId) },
    };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "PRIVACY_UNAVAILABLE",
      "We couldn't update your resume privacy setting. Please try again.",
      503,
    );
  }
}
