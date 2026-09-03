import { NextResponse } from "next/server";

import { applicationSettingsRepository } from "@/lib/applications/settings-repository";
import type {
  ApplicationsErrorCode,
  ApplicationsErrorResponse,
  GetApplicationSettingsResponse,
  SaveApplicationSettingsResponse,
} from "@/lib/applications/types";
import {
  ApplicationValidationError,
  parseApplicationSettings,
} from "@/lib/applications/validation";
import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(
  code: ApplicationsErrorCode,
  message: string,
  status: number,
) {
  const body: ApplicationsErrorResponse = { error: { code, message } };
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
      "Sign in to manage application settings.",
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
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to load settings.", 401);
  }

  try {
    const settings = await applicationSettingsRepository.get(
      authentication.userId,
    );
    const body: GetApplicationSettingsResponse = { data: { settings } };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't load application settings. Please try again.",
      503,
    );
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticatedUserId(request);
  const authError = authenticationError(authentication);
  if (authError) return authError;
  if (authentication.status !== "authenticated") {
    return errorResponse("AUTH_REQUIRED", "Sign in to update settings.", 401);
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(
      "INVALID_REQUEST",
      "Send application settings as JSON.",
      400,
    );
  }

  let settings;
  try {
    settings = parseApplicationSettings(await request.json());
  } catch (error) {
    return errorResponse(
      error instanceof ApplicationValidationError
        ? "INVALID_SETTINGS"
        : "INVALID_REQUEST",
      error instanceof ApplicationValidationError
        ? error.message
        : "The request body must contain valid JSON.",
      error instanceof ApplicationValidationError ? 422 : 400,
    );
  }

  try {
    const saved = await applicationSettingsRepository.save(
      authentication.userId,
      settings,
    );
    const body: SaveApplicationSettingsResponse = { data: { settings: saved } };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "APPLICATIONS_UNAVAILABLE",
      "We couldn't save application settings. Please try again.",
      503,
    );
  }
}
