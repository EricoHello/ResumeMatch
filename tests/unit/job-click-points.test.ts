import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const eligibilityMocks = vi.hoisted(() => ({
  validate: vi.fn(),
  complete: vi.fn(),
}));
const pointsMocks = vi.hoisted(() => ({
  earn: vi.fn(),
  hasEarnings: vi.fn(),
}));

vi.mock("@/lib/points/job-click-eligibility", () => ({
  jobClickEligibility: eligibilityMocks,
}));

vi.mock("@/lib/points/repository", () => ({
  pointsRepository: pointsMocks,
}));

import { awardJobClickPoints } from "@/lib/points/job-click";

const INPUT = {
  searchId: "search-123",
  jobIndex: 2,
  clickToken: "click-token-3",
};
const CLICK_RESULT = {
  applied: true,
  points: { balance: 30, totalEarned: 30, totalSpent: 0 },
  entry: {
    id: "click-entry",
    kind: "earn",
    action: "job_click",
    amount: 10,
    description: "Viewed suggested job 3",
    timestamp: "2026-09-01T12:00:00.000Z",
  },
};
const BONUS_RESULT = {
  applied: true,
  points: { balance: 35, totalEarned: 35, totalSpent: 0 },
  entry: {
    id: "bonus-entry",
    kind: "earn",
    action: "all_job_clicks_bonus",
    amount: 5,
    description: "Viewed all three suggested jobs",
    timestamp: "2026-09-01T12:00:00.000Z",
  },
};

describe("awardJobClickPoints", () => {
  beforeEach(() => {
    eligibilityMocks.validate.mockReset().mockResolvedValue({ jobCount: 3 });
    eligibilityMocks.complete.mockReset().mockResolvedValue(undefined);
    pointsMocks.earn.mockReset().mockResolvedValueOnce(CLICK_RESULT);
    pointsMocks.hasEarnings.mockReset().mockResolvedValue(false);
  });

  it("awards ten points using a stable card-specific action key", async () => {
    await expect(
      awardJobClickPoints("verified-user", INPUT),
    ).resolves.toEqual({
      points: CLICK_RESULT.points,
      clickAwarded: true,
      bonusAwarded: false,
    });

    expect(eligibilityMocks.validate).toHaveBeenCalledWith(
      "verified-user",
      INPUT,
    );
    expect(pointsMocks.earn).toHaveBeenCalledWith("verified-user", {
      amount: 10,
      action: "job_click",
      description: "Viewed suggested job 3",
      idempotencyKey: "job-search:search-123:job:2",
    });
    expect(pointsMocks.hasEarnings).toHaveBeenCalledWith("verified-user", [
      "job-search:search-123:job:0",
      "job-search:search-123:job:1",
      "job-search:search-123:job:2",
    ]);
  });

  it("awards the five-point bonus once all three click entries exist", async () => {
    pointsMocks.hasEarnings.mockResolvedValue(true);
    pointsMocks.earn
      .mockReset()
      .mockResolvedValueOnce(CLICK_RESULT)
      .mockResolvedValueOnce(BONUS_RESULT);

    await expect(
      awardJobClickPoints("verified-user", INPUT),
    ).resolves.toEqual({
      points: BONUS_RESULT.points,
      clickAwarded: true,
      bonusAwarded: true,
    });
    expect(pointsMocks.earn).toHaveBeenLastCalledWith("verified-user", {
      amount: 5,
      action: "all_job_clicks_bonus",
      description: "Viewed all three suggested jobs",
      idempotencyKey: "job-search:search-123:all-clicked",
    });
    expect(eligibilityMocks.complete).toHaveBeenCalledWith(
      "verified-user",
      "search-123",
    );
  });

  it("does not offer the three-job bonus when fewer jobs were displayed", async () => {
    eligibilityMocks.validate.mockResolvedValue({ jobCount: 2 });

    await awardJobClickPoints("verified-user", { ...INPUT, jobIndex: 1 });

    expect(pointsMocks.hasEarnings).not.toHaveBeenCalled();
    expect(pointsMocks.earn).toHaveBeenCalledOnce();
    expect(eligibilityMocks.complete).not.toHaveBeenCalled();
  });
});
