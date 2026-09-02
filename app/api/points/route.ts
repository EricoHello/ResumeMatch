import { NextResponse } from "next/server";

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
} from "@/lib/firebase/auth";
import { pointsRepository } from "@/lib/points/repository";
import type {
  PointsErrorCode,
  PointsErrorResponse,
  PointsResponse,
} from "@/lib/points/types";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(
  code: PointsErrorCode,
  message: string,
  status: number,
) {
  const body: PointsErrorResponse = { error: { code, message } };
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function GET(request: Request) {
  let userId: string;

  try {
    userId = await authenticateFirebaseRequest(request);
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return errorResponse(
        "AUTH_REQUIRED",
        "Sign in to load your points.",
        401,
      );
    }

    return errorResponse(
      "AUTH_UNAVAILABLE",
      "We couldn't verify your sign-in right now. Please try again.",
      503,
    );
  }

  try {
    const snapshot = await pointsRepository.get(userId);
    const body: PointsResponse = { data: snapshot };
    return NextResponse.json(body, { headers: RESPONSE_HEADERS });
  } catch {
    return errorResponse(
      "POINTS_UNAVAILABLE",
      "We couldn't load your points. Please try again.",
      503,
    );
  }
}

