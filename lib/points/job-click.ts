import "server-only";

import { jobClickEligibility } from "./job-click-eligibility";
import {
  allJobClicksIdempotencyKey,
  jobClickIdempotencyKey,
  type AwardJobClickRequest,
  type AwardJobClickResult,
} from "./job-click-types";
import { pointsRepository } from "./repository";

const JOB_CLICK_POINTS = 10;
const ALL_JOB_CLICKS_BONUS = 5;
const EXPECTED_BONUS_JOB_COUNT = 3;

export async function awardJobClickPoints(
  userId: string,
  input: AwardJobClickRequest,
): Promise<AwardJobClickResult> {
  const eligibility = await jobClickEligibility.validate(userId, input);
  const clickKey = jobClickIdempotencyKey(input.searchId, input.jobIndex);
  const clickResult = await pointsRepository.earn(userId, {
    amount: JOB_CLICK_POINTS,
    action: "job_click",
    description: `Viewed suggested job ${input.jobIndex + 1}`,
    idempotencyKey: clickKey,
  });

  if (eligibility.jobCount !== EXPECTED_BONUS_JOB_COUNT) {
    return {
      points: clickResult.points,
      clickAwarded: clickResult.applied,
      bonusAwarded: false,
    };
  }

  const allClickKeys = Array.from(
    { length: EXPECTED_BONUS_JOB_COUNT },
    (_, jobIndex) => jobClickIdempotencyKey(input.searchId, jobIndex),
  );
  const allClicked = await pointsRepository.hasEarnings(
    userId,
    allClickKeys,
  );
  if (!allClicked) {
    return {
      points: clickResult.points,
      clickAwarded: clickResult.applied,
      bonusAwarded: false,
    };
  }

  const bonusResult = await pointsRepository.earn(userId, {
    amount: ALL_JOB_CLICKS_BONUS,
    action: "all_job_clicks_bonus",
    description: "Viewed all three suggested jobs",
    idempotencyKey: allJobClicksIdempotencyKey(input.searchId),
  });

  try {
    await jobClickEligibility.complete(userId, input.searchId);
  } catch {
    // The point ledger is authoritative; stale eligibility can expire safely.
  }

  return {
    points: bonusResult.points,
    clickAwarded: clickResult.applied,
    bonusAwarded: bonusResult.applied,
  };
}

