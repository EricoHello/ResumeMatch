import type { User } from "firebase/auth";

import {
  allJobClicksIdempotencyKey,
  jobClickIdempotencyKey,
  type AwardJobClickResponse,
  type AwardJobClickResult,
  type JobClickRewardContext,
} from "./job-click-types";
import { parseJobClickRewardContext } from "./job-click-validation";
import { earnGuestPoints, readGuestPoints } from "./guest";
import { parsePointBalance } from "./validation";

export class JobClickAwardClientError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "JobClickAwardClientError";
  }
}

function validContext(context: JobClickRewardContext, jobIndex: number) {
  const parsed = parseJobClickRewardContext(context);
  if (!parsed || !Number.isInteger(jobIndex) || !parsed.clickTokens[jobIndex]) {
    throw new JobClickAwardClientError(
      "This job click is not eligible for points.",
    );
  }
  return parsed;
}

function parseAwardResult(value: unknown): AwardJobClickResult {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new JobClickAwardClientError(
      "The points service returned an unexpected response.",
    );
  }

  const data = value.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("points" in data) ||
    !("clickAwarded" in data) ||
    typeof data.clickAwarded !== "boolean" ||
    !("bonusAwarded" in data) ||
    typeof data.bonusAwarded !== "boolean"
  ) {
    throw new JobClickAwardClientError(
      "The points service returned an unexpected response.",
    );
  }

  return {
    points: parsePointBalance(data.points),
    clickAwarded: data.clickAwarded,
    bonusAwarded: data.bonusAwarded,
  };
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
    // Use the stable fallback below.
  }
  return "We couldn't add points for this job click.";
}

export async function awardSignedInJobClick(
  user: User,
  context: JobClickRewardContext,
  jobIndex: number,
): Promise<AwardJobClickResult> {
  const parsed = validContext(context, jobIndex);
  let response: Response;

  try {
    const token = await user.getIdToken();
    response = await fetch("/api/points/job-click", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        searchId: parsed.searchId,
        jobIndex,
        clickToken: parsed.clickTokens[jobIndex],
      }),
      keepalive: true,
    });
  } catch {
    throw new JobClickAwardClientError(
      "We couldn't add points for this job click.",
    );
  }

  if (!response.ok) {
    throw new JobClickAwardClientError(
      await responseMessage(response),
      response.status,
    );
  }

  const body = (await response.json()) as AwardJobClickResponse;
  return parseAwardResult(body);
}

export function awardGuestJobClick(
  context: JobClickRewardContext,
  jobIndex: number,
): AwardJobClickResult {
  const parsed = validContext(context, jobIndex);
  const clickResult = earnGuestPoints({
    amount: 10,
    action: "job_click",
    description: `Viewed suggested job ${jobIndex + 1}`,
    idempotencyKey: jobClickIdempotencyKey(parsed.searchId, jobIndex),
  });

  if (parsed.clickTokens.length !== 3) {
    return {
      points: clickResult.points,
      clickAwarded: clickResult.applied,
      bonusAwarded: false,
    };
  }

  const historyIds = new Set(readGuestPoints().history.map((entry) => entry.id));
  const allClicked = Array.from({ length: 3 }, (_, index) =>
    historyIds.has(`earn:${jobClickIdempotencyKey(parsed.searchId, index)}`),
  ).every(Boolean);
  if (!allClicked) {
    return {
      points: clickResult.points,
      clickAwarded: clickResult.applied,
      bonusAwarded: false,
    };
  }

  const bonusResult = earnGuestPoints({
    amount: 5,
    action: "all_job_clicks_bonus",
    description: "Viewed all three suggested jobs",
    idempotencyKey: allJobClicksIdempotencyKey(parsed.searchId),
  });
  return {
    points: bonusResult.points,
    clickAwarded: clickResult.applied,
    bonusAwarded: bonusResult.applied,
  };
}
