import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return {
    authenticate: vi.fn(),
    TestFirebaseAuthenticationError,
  };
});
const awardMocks = vi.hoisted(() => ({ award: vi.fn() }));
const eligibilityMocks = vi.hoisted(() => {
  class TestInvalidJobClickEligibilityError extends Error {}
  return { TestInvalidJobClickEligibilityError };
});

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));

vi.mock("@/lib/points/job-click", () => ({
  awardJobClickPoints: awardMocks.award,
}));

vi.mock("@/lib/points/job-click-eligibility", () => ({
  InvalidJobClickEligibilityError:
    eligibilityMocks.TestInvalidJobClickEligibilityError,
}));

import { POST } from "@/app/api/points/job-click/route";

const INPUT = {
  searchId: "search-123",
  jobIndex: 2,
  clickToken: "click-token-3",
};
const RESULT = {
  points: { balance: 35, totalEarned: 35, totalSpent: 0 },
  clickAwarded: true,
  bonusAwarded: true,
};

function request(
  body = JSON.stringify(INPUT),
  contentType = "application/json",
) {
  return new Request("http://localhost/api/points/job-click", {
    method: "POST",
    headers: {
      authorization: "Bearer test-id-token",
      "content-type": contentType,
    },
    body,
  });
}

describe("POST /api/points/job-click", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset().mockResolvedValue("verified-user");
    awardMocks.award.mockReset().mockResolvedValue(RESULT);
  });

  it("awards only against the authenticated user's eligible search", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: RESULT });
    expect(awardMocks.award).toHaveBeenCalledWith("verified-user", INPUT);
  });

  it("rejects unauthenticated requests before processing a click", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(awardMocks.award).not.toHaveBeenCalled();
  });

  it("rejects malformed, extra, and non-JSON input", async () => {
    const malformed = await POST(request("{bad"));
    const extra = await POST(
      request(JSON.stringify({ ...INPUT, amount: 10_000 })),
    );
    const wrongType = await POST(request(JSON.stringify(INPUT), "text/plain"));

    expect(malformed.status).toBe(422);
    expect(extra.status).toBe(422);
    expect(wrongType.status).toBe(400);
    expect(awardMocks.award).not.toHaveBeenCalled();
  });

  it("rejects a click that was not issued for the displayed search", async () => {
    awardMocks.award.mockRejectedValue(
      new eligibilityMocks.TestInvalidJobClickEligibilityError(),
    );

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_JOB_CLICK" },
    });
  });

  it("does not expose authentication or point-service failure details", async () => {
    authMocks.authenticate.mockRejectedValueOnce(
      new Error("private auth configuration"),
    );
    const authResponse = await POST(request());
    expect(authResponse.status).toBe(503);
    expect(JSON.stringify(await authResponse.json())).not.toContain("private");

    authMocks.authenticate.mockResolvedValueOnce("verified-user");
    awardMocks.award.mockRejectedValueOnce(new Error("private ledger detail"));
    const awardResponse = await POST(request());
    expect(awardResponse.status).toBe(503);
    expect(JSON.stringify(await awardResponse.json())).not.toContain("private");
  });
});

