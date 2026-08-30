import { NextResponse } from "next/server";

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";
import { preferencesRepository } from "@/lib/preferences/repository";
import {
  parseJobPreferences,
  PreferencesValidationError,
} from "@/lib/preferences/validation";
import type {
  GetPreferencesResponse,
  PreferencesErrorCode,
  PreferencesErrorResponse,
  SavePreferencesResponse,
} from "@/lib/preferences/types";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(
  code: PreferencesErrorCode,
  message: string,
  status: number,
) {
  const body: PreferencesErrorResponse = {
    error: { code, message },
  };

  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
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

export async function GET(request: Request) {
  const authentication = await authenticatedUserId(request);

  if (authentication.status === "required") {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to load your job preferences.",
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

  const { userId } = authentication;

  try {
    const preferences = await preferencesRepository.get(userId);
    const body: GetPreferencesResponse = {
      data: { preferences },
    };

    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "PREFERENCES_UNAVAILABLE",
      "We couldn't load your job preferences. Please try again.",
      503,
    );
  }
}

export async function PUT(request: Request) {
  const authentication = await authenticatedUserId(request);

  if (authentication.status === "required") {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to save your job preferences.",
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

  const { userId } = authentication;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    return errorResponse(
      "INVALID_REQUEST",
      "Send job preferences as JSON.",
      400,
    );
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

  let preferences;

  try {
    preferences = parseJobPreferences(requestBody);
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      return errorResponse("INVALID_PREFERENCES", error.message, 422);
    }

    return errorResponse(
      "INVALID_PREFERENCES",
      "The job preferences are invalid.",
      422,
    );
  }

  try {
    const savedPreferences = await preferencesRepository.save(
      userId,
      preferences,
    );
    const body: SavePreferencesResponse = {
      data: { preferences: savedPreferences },
    };

    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "PREFERENCES_UNAVAILABLE",
      "We couldn't save your job preferences. Please try again.",
      503,
    );
  }
}
