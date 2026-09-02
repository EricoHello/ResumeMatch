import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  class TestFirebaseAuthenticatedEmailUnavailableError extends Error {}

  return {
    authenticateIdentity: vi.fn(),
    authenticateUserId: vi.fn(),
    TestFirebaseAuthenticationError,
    TestFirebaseAuthenticatedEmailUnavailableError,
  };
});

const repositoryMocks = vi.hoisted(() => ({
  export: vi.fn(),
  delete: vi.fn(),
}));

const emailMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseIdentity: authMocks.authenticateIdentity,
  authenticateFirebaseRequest: authMocks.authenticateUserId,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
  FirebaseAuthenticatedEmailUnavailableError:
    authMocks.TestFirebaseAuthenticatedEmailUnavailableError,
}));

vi.mock("@/lib/account/repository", () => ({
  accountDataRepository: repositoryMocks,
}));

vi.mock("@/lib/account/email", () => ({
  accountDataEmailSender: emailMocks,
}));

import { DELETE, POST } from "@/app/api/account/data/route";

const USER_ID = "verified-user";
const AUTHENTICATED_EMAIL = "owner@example.test";
const DATA_EXPORT = {
  schemaVersion: 3 as const,
  generatedAt: "2026-08-30T12:00:00.000Z",
  data: {
    savedPreferences: null,
    extractedResumeText: "Stored resume text for the authenticated user.",
    aiCandidateProfile: null,
    privacySettings: { saveResumeData: true },
    points: {
      points: { balance: 0, totalEarned: 0, totalSpent: 0 },
      history: [],
    },
  },
};

function request(method: "POST" | "DELETE") {
  return new Request("http://localhost/api/account/data", {
    method,
    headers: { Authorization: "Bearer test-id-token" },
  });
}

describe("authenticated account data route", () => {
  beforeEach(() => {
    authMocks.authenticateIdentity.mockReset();
    authMocks.authenticateUserId.mockReset();
    repositoryMocks.export.mockReset();
    repositoryMocks.delete.mockReset();
    emailMocks.send.mockReset();
    authMocks.authenticateIdentity.mockResolvedValue({
      userId: USER_ID,
      email: AUTHENTICATED_EMAIL,
    });
    authMocks.authenticateUserId.mockResolvedValue(USER_ID);
    repositoryMocks.export.mockResolvedValue(DATA_EXPORT);
    repositoryMocks.delete.mockResolvedValue(undefined);
    emailMocks.send.mockResolvedValue(undefined);
  });

  it("emails only the address from the verified Firebase identity", async () => {
    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { sent: true } });
    expect(repositoryMocks.export).toHaveBeenCalledWith(USER_ID);
    expect(emailMocks.send).toHaveBeenCalledWith(
      AUTHENTICATED_EMAIL,
      DATA_EXPORT,
    );
    expect(emailMocks.send).toHaveBeenCalledOnce();
  });

  it("recursively deletes only the verified user's Firestore data", async () => {
    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { deleted: true } });
    expect(repositoryMocks.delete).toHaveBeenCalledOnce();
    expect(repositoryMocks.delete).toHaveBeenCalledWith(USER_ID);
    expect(repositoryMocks.export).not.toHaveBeenCalled();
    expect(emailMocks.send).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated export and deletion without touching data", async () => {
    authMocks.authenticateIdentity.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );
    authMocks.authenticateUserId.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const sendResponse = await POST(request("POST"));
    const deleteResponse = await DELETE(request("DELETE"));

    expect(sendResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(repositoryMocks.export).not.toHaveBeenCalled();
    expect(repositoryMocks.delete).not.toHaveBeenCalled();
    expect(emailMocks.send).not.toHaveBeenCalled();
  });

  it("requires a verified authenticated email before reading export data", async () => {
    authMocks.authenticateIdentity.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticatedEmailUnavailableError(),
    );

    const response = await POST(request("POST"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_UNAVAILABLE" },
    });
    expect(repositoryMocks.export).not.toHaveBeenCalled();
    expect(emailMocks.send).not.toHaveBeenCalled();
  });

  it("does not expose data, mail, or Firestore failure details", async () => {
    repositoryMocks.export.mockRejectedValueOnce(
      new Error("private extracted resume text"),
    );
    const exportResponse = await POST(request("POST"));
    expect(exportResponse.status).toBe(503);
    expect(JSON.stringify(await exportResponse.json())).not.toContain(
      "private extracted",
    );

    repositoryMocks.export.mockResolvedValueOnce(DATA_EXPORT);
    emailMocks.send.mockRejectedValueOnce(new Error("private mail key"));
    const emailResponse = await POST(request("POST"));
    expect(emailResponse.status).toBe(503);
    expect(JSON.stringify(await emailResponse.json())).not.toContain(
      "private mail",
    );

    repositoryMocks.delete.mockRejectedValueOnce(
      new Error("private Firestore path"),
    );
    const deleteResponse = await DELETE(request("DELETE"));
    expect(deleteResponse.status).toBe(503);
    expect(JSON.stringify(await deleteResponse.json())).not.toContain(
      "private Firestore",
    );
  });
});
