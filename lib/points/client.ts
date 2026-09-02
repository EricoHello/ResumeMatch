import type { User } from "firebase/auth";

import type { PointAccountSnapshot, PointsResponse } from "./types";
import { parsePointAccountSnapshot } from "./validation";

export class PointsClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PointsClientError";
  }
}

async function responseMessage(response: Response) {
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
    // Fall back to a stable client message.
  }

  return "We couldn't load your points. Please try again.";
}

export async function loadPoints(user: User): Promise<PointAccountSnapshot> {
  const token = await user.getIdToken();
  const response = await fetch("/api/points", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new PointsClientError(await responseMessage(response), response.status);
  }

  const body = (await response.json()) as PointsResponse;
  return parsePointAccountSnapshot(body.data);
}

