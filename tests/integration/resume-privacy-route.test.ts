import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return {
    authenticate: vi.fn(),
    TestFirebaseAuthenticationError,
  };
});

const privacyMocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

const resumeMocks = vi.hoisted(() => ({ exists: vi.fn() }));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));

vi.mock("@/lib/privacy/repository", () => ({
  resumePrivacyRepository: privacyMocks,
}));

vi.mock("@/lib/resume/saved-repository", () => ({
  savedResumeRepository: resumeMocks,
}));

import { GET, PUT } from "@/app/api/account/privacy/route";

const USER_ID = "verified-user";

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("http://localhost/api/account/privacy", {
    method,
    headers: {
      Authorization: "Bearer test-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("authenticated resume privacy route", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset();
    privacyMocks.get.mockReset();
    privacyMocks.save.mockReset();
    resumeMocks.exists.mockReset();
    authMocks.authenticate.mockResolvedValue(USER_ID);
    privacyMocks.get.mockResolvedValue({ saveResumeData: true });
    privacyMocks.save.mockImplementation(async (_userId, settings) => settings);
    resumeMocks.exists.mockResolvedValue(false);
  });

  it("returns the default enabled setting and saved-data status", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        privacy: { saveResumeData: true, hasSavedResumeData: false },
      },
    });
    expect(privacyMocks.get).toHaveBeenCalledWith(USER_ID);
    expect(resumeMocks.exists).toHaveBeenCalledWith(USER_ID);
  });

  it("persists an exact disabled setting and reports existing resume data", async () => {
    privacyMocks.get.mockResolvedValue({ saveResumeData: false });
    resumeMocks.exists.mockResolvedValue(true);

    const response = await PUT(request("PUT", { saveResumeData: false }));

    expect(response.status).toBe(200);
    expect(privacyMocks.save).toHaveBeenCalledWith(USER_ID, {
      saveResumeData: false,
    });
    await expect(response.json()).resolves.toEqual({
      data: {
        privacy: { saveResumeData: false, hasSavedResumeData: true },
      },
    });
  });

  it.each([
    [{ saveResumeData: "false" }],
    [{ saveResumeData: false, uid: "another-user" }],
    [{}],
  ])("rejects an invalid setting without writing", async (body) => {
    const response = await PUT(request("PUT", body));

    expect(response.status).toBe(422);
    expect(privacyMocks.save).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access without touching Firestore", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const getResponse = await GET(request("GET"));
    const putResponse = await PUT(request("PUT", { saveResumeData: false }));

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(privacyMocks.get).not.toHaveBeenCalled();
    expect(privacyMocks.save).not.toHaveBeenCalled();
    expect(resumeMocks.exists).not.toHaveBeenCalled();
  });

  it("does not expose repository failures", async () => {
    privacyMocks.get.mockRejectedValue(new Error("private Firestore setting"));

    const response = await GET(request("GET"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("private Firestore");
  });
});
