import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { awardSignedInJobClick } from "@/lib/points/job-click-client";

const CONTEXT = {
  searchId: "search-123",
  clickTokens: ["token-one", "token-two", "token-three"],
};

describe("signed-in job-click client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the issued card token with the Firebase identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          points: { balance: 20, totalEarned: 20, totalSpent: 0 },
          clickAwarded: true,
          bonusAwarded: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = {
      getIdToken: vi.fn().mockResolvedValue("firebase-token"),
    } as unknown as User;

    await expect(
      awardSignedInJobClick(user, CONTEXT, 1),
    ).resolves.toMatchObject({
      points: { balance: 20 },
      clickAwarded: true,
      bonusAwarded: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/points/job-click");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({
      Authorization: "Bearer firebase-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      searchId: "search-123",
      jobIndex: 1,
      clickToken: "token-two",
    });
  });
});

