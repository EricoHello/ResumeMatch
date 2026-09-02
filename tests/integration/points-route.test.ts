import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return {
    authenticate: vi.fn(),
    TestFirebaseAuthenticationError,
  };
});
const repositoryMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));

vi.mock("@/lib/points/repository", () => ({
  pointsRepository: repositoryMocks,
}));

import { GET } from "@/app/api/points/route";

const USER_ID = "verified-user";
const SNAPSHOT = {
  points: { balance: 25, totalEarned: 40, totalSpent: 15 },
  history: [],
};

function request() {
  return new Request("http://localhost/api/points", {
    headers: { Authorization: "Bearer test-id-token" },
  });
}

describe("GET /api/points", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset();
    repositoryMocks.get.mockReset();
    authMocks.authenticate.mockResolvedValue(USER_ID);
    repositoryMocks.get.mockResolvedValue(SNAPSHOT);
  });

  it("loads only the authenticated user's point account", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: SNAPSHOT });
    expect(repositoryMocks.get).toHaveBeenCalledWith(USER_ID);
  });

  it("rejects unauthenticated requests before reading Firestore", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
    expect(repositoryMocks.get).not.toHaveBeenCalled();
  });

  it("does not expose authentication or Firestore failure details", async () => {
    authMocks.authenticate.mockRejectedValueOnce(
      new Error("private auth configuration"),
    );
    const authResponse = await GET(request());
    expect(authResponse.status).toBe(503);
    expect(JSON.stringify(await authResponse.json())).not.toContain(
      "private auth",
    );

    authMocks.authenticate.mockResolvedValueOnce(USER_ID);
    repositoryMocks.get.mockRejectedValueOnce(
      new Error("private point history"),
    );
    const dataResponse = await GET(request());
    expect(dataResponse.status).toBe(503);
    expect(JSON.stringify(await dataResponse.json())).not.toContain(
      "private point",
    );
  });
});

