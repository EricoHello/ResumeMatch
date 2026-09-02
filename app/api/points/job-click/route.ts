import { NextResponse } from "next/server";

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";
import {
  InvalidJobClickEligibilityError,
} from "@/lib/points/job-click-eligibility";
import { awardJobClickPoints } from "@/lib/points/job-click";
import type {
  AwardJobClickErrorCode,
  AwardJobClickErrorResponse,
  AwardJobClickResponse,
} from "@/lib/points/job-click-types";
import {
  JobClickValidationError,
  parseAwardJobClickRequest,
} from "@/lib/points/job-click-validation";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };
const MAX_REQUEST_BYTES = 4 * 1024;

function errorResponse(
  code: AwardJobClickErrorCode,
  message: string,
  status: number,
) {
  const body: AwardJobClickErrorResponse = { error: { code, message } };
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

async function readJson(request: Request) {
  const text = await request.text();
  if (
    text.length === 0 ||
    new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES
  ) {
    throw new JobClickValidationError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JobClickValidationError();
  }
}

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await authenticateFirebaseRequest(request);
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return errorResponse(
        "AUTH_REQUIRED",
        "Sign in to earn persistent points.",
        401,
      );
    }
    return errorResponse(
      "AUTH_UNAVAILABLE",
      "We couldn't verify your sign-in right now. Please try again.",
      503,
    );
  }

  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Send the job-click reward as JSON.",
      400,
    );
  }

  let input;
  try {
    input = parseAwardJobClickRequest(await readJson(request));
  } catch (error) {
    return errorResponse(
      error instanceof JobClickValidationError
        ? "INVALID_REQUEST"
        : "POINTS_UNAVAILABLE",
      error instanceof JobClickValidationError
        ? error.message
        : "We couldn't add points for this job click.",
      error instanceof JobClickValidationError ? 422 : 503,
    );
  }

  try {
    const result = await awardJobClickPoints(userId, input);
    const body: AwardJobClickResponse = { data: result };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof InvalidJobClickEligibilityError) {
      return errorResponse(
        "INVALID_JOB_CLICK",
        "This job click is not eligible for points.",
        422,
      );
    }
    return errorResponse(
      "POINTS_UNAVAILABLE",
      "We couldn't add points for this job click.",
      503,
    );
  }
}

