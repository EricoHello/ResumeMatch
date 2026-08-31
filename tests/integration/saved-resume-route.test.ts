import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return {
    authenticate: vi.fn(),
    TestFirebaseAuthenticationError,
  };
});

const repositoryMocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));

vi.mock("@/lib/resume/saved-repository", () => ({
  savedResumeRepository: repositoryMocks,
}));

import { GET, PUT } from "@/app/api/resumes/saved/route";

const USER_ID = "verified-user";
const SAVED_RESUME = {
  resumeText: "Ada Lovelace is a senior software engineer with TypeScript.",
  profile: null,
};

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("http://localhost/api/resumes/saved", {
    method,
    headers: {
      Authorization: "Bearer test-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("authenticated saved resume route", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset();
    repositoryMocks.get.mockReset();
    repositoryMocks.save.mockReset();
    authMocks.authenticate.mockResolvedValue(USER_ID);
  });

  it("loads only the verified user's saved resume", async () => {
    repositoryMocks.get.mockResolvedValue(SAVED_RESUME);
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { savedResume: SAVED_RESUME },
    });
    expect(repositoryMocks.get).toHaveBeenCalledWith(USER_ID);
  });

  it("normalizes and saves under only the verified UID", async () => {
    repositoryMocks.save.mockImplementation(async (_uid, savedResume) => savedResume);
    const response = await PUT(
      request("PUT", {
        resumeText: `  ${SAVED_RESUME.resumeText}  `,
        profile: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(repositoryMocks.save).toHaveBeenCalledWith(USER_ID, SAVED_RESUME);
    await expect(response.json()).resolves.toEqual({
      data: { savedResume: SAVED_RESUME },
    });
  });

  it("rejects guest access without touching Firestore", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const getResponse = await GET(request("GET"));
    const putResponse = await PUT(request("PUT", SAVED_RESUME));

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(repositoryMocks.get).not.toHaveBeenCalled();
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("rejects extra or invalid persisted fields", async () => {
    const response = await PUT(
      request("PUT", { ...SAVED_RESUME, originalFile: "base64-data" }),
    );

    expect(response.status).toBe(422);
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("does not expose authentication or repository failures", async () => {
    authMocks.authenticate.mockRejectedValueOnce(new Error("private auth detail"));
    const authResponse = await GET(request("GET"));
    expect(authResponse.status).toBe(503);
    expect(JSON.stringify(await authResponse.json())).not.toContain("private");

    authMocks.authenticate.mockResolvedValueOnce(USER_ID);
    repositoryMocks.get.mockRejectedValueOnce(new Error("private resume text"));
    const storageResponse = await GET(request("GET"));
    expect(storageResponse.status).toBe(503);
    expect(JSON.stringify(await storageResponse.json())).not.toContain("private resume");
  });
});
