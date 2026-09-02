// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearGuestPoints,
  earnGuestPoints,
  InsufficientGuestPointsError,
  readGuestPoints,
  spendGuestPoints,
} from "@/lib/points/guest";
import { PointIdempotencyConflictError } from "@/lib/points/validation";
import { awardGuestJobClick } from "@/lib/points/job-click-client";
import { beginGuestSession, clearGuestSession } from "@/lib/session/guest-session";

const AWARD = {
  amount: 10,
  action: "guest_test",
  description: "Completed a guest-only test action",
  idempotencyKey: "guest-session:action-1",
};

describe("guest points", () => {
  beforeEach(() => {
    clearGuestPoints();
    window.sessionStorage.clear();
  });

  it("keeps totals and history only in session storage", () => {
    const result = earnGuestPoints(AWARD);

    expect(result).toMatchObject({
      applied: true,
      points: { balance: 10, totalEarned: 10, totalSpent: 0 },
    });
    expect(readGuestPoints()).toEqual({
      points: { balance: 10, totalEarned: 10, totalSpent: 0 },
      history: [result.entry],
    });
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(1);
  });

  it("does not award the same guest action twice", () => {
    const first = earnGuestPoints(AWARD);
    const retry = earnGuestPoints(AWARD);

    expect(retry).toEqual({ ...first, applied: false });
    expect(readGuestPoints().history).toHaveLength(1);
  });

  it("rejects conflicting reuse of a guest idempotency key", () => {
    earnGuestPoints(AWARD);

    expect(() =>
      earnGuestPoints({ ...AWARD, amount: 20 }),
    ).toThrow(PointIdempotencyConflictError);
  });

  it("tracks spending and clears with the guest session lifecycle", () => {
    beginGuestSession();
    earnGuestPoints(AWARD);
    const spend = spendGuestPoints({
      amount: 4,
      action: "guest_reward",
      description: "Used a guest reward",
      idempotencyKey: "guest-session:spend-1",
    });

    expect(spend.points).toEqual({
      balance: 6,
      totalEarned: 10,
      totalSpent: 4,
    });
    clearGuestSession();
    expect(readGuestPoints()).toEqual({
      points: { balance: 0, totalEarned: 0, totalSpent: 0 },
      history: [],
    });
  });

  it("blocks ordinary guest overspending", () => {
    expect(() =>
      spendGuestPoints({
        amount: 1,
        action: "guest_reward",
        description: "Used a guest reward",
        idempotencyKey: "guest-session:spend-1",
      }),
    ).toThrow(InsufficientGuestPointsError);
  });

  it("awards each displayed job once and adds one all-three bonus", () => {
    const context = {
      searchId: "search-123",
      clickTokens: ["token-one", "token-two", "token-three"],
    };

    expect(awardGuestJobClick(context, 0).points.balance).toBe(10);
    expect(awardGuestJobClick(context, 0)).toMatchObject({
      clickAwarded: false,
      points: { balance: 10 },
    });
    expect(awardGuestJobClick(context, 1).points.balance).toBe(20);
    expect(awardGuestJobClick(context, 2)).toMatchObject({
      clickAwarded: true,
      bonusAwarded: true,
      points: { balance: 35, totalEarned: 35, totalSpent: 0 },
    });
    expect(awardGuestJobClick(context, 2)).toMatchObject({
      clickAwarded: false,
      bonusAwarded: false,
      points: { balance: 35 },
    });
    expect(readGuestPoints().history).toHaveLength(4);
  });
});
