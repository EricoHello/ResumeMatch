import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const adminMocks = vi.hoisted(() => ({
  getFirebaseAdminAuth: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirebaseAdminAuth: adminMocks.getFirebaseAdminAuth,
}));

import {
  authenticateFirebaseRequest,
  FirebaseAuthenticationError,
  FirebaseAuthenticationUnavailableError,
} from "@/lib/firebase/auth";

describe("authenticateFirebaseRequest", () => {
  beforeEach(() => {
    adminMocks.getFirebaseAdminAuth.mockReset();
    adminMocks.verifyIdToken.mockReset();
    adminMocks.getFirebaseAdminAuth.mockReturnValue({
      verifyIdToken: adminMocks.verifyIdToken,
    });
  });

  it("returns only the UID verified by Firebase Admin", async () => {
    adminMocks.verifyIdToken.mockResolvedValue({ uid: "firebase-user-123" });
    const request = new Request("http://localhost/api/preferences", {
      headers: { authorization: "Bearer verified-id-token" },
    });

    await expect(authenticateFirebaseRequest(request)).resolves.toBe(
      "firebase-user-123",
    );
    expect(adminMocks.verifyIdToken).toHaveBeenCalledWith("verified-id-token");
  });

  it.each([
    undefined,
    "",
    "Basic abc123",
    "Bearer",
    "Bearer token with spaces",
  ])("rejects a malformed authorization header", async (authorization) => {
    const headers = new Headers();

    if (authorization !== undefined) {
      headers.set("authorization", authorization);
    }

    await expect(
      authenticateFirebaseRequest(
        new Request("http://localhost/api/preferences", { headers }),
      ),
    ).rejects.toBeInstanceOf(FirebaseAuthenticationError);
    expect(adminMocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("converts Firebase verification failures to a safe auth error", async () => {
    adminMocks.verifyIdToken.mockRejectedValue(
      new Error("secret verifier implementation detail"),
    );

    await expect(
      authenticateFirebaseRequest(
        new Request("http://localhost/api/preferences", {
          headers: { authorization: "Bearer expired-token" },
        }),
      ),
    ).rejects.toEqual(new FirebaseAuthenticationError());
  });

  it("distinguishes unavailable Admin configuration from an invalid token", async () => {
    adminMocks.getFirebaseAdminAuth.mockImplementation(() => {
      throw new Error("private service-account configuration detail");
    });

    await expect(
      authenticateFirebaseRequest(
        new Request("http://localhost/api/preferences", {
          headers: { authorization: "Bearer otherwise-valid-token" },
        }),
      ),
    ).rejects.toEqual(new FirebaseAuthenticationUnavailableError());
    expect(adminMocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects decoded tokens without a UID", async () => {
    adminMocks.verifyIdToken.mockResolvedValue({ email: "person@example.com" });

    await expect(
      authenticateFirebaseRequest(
        new Request("http://localhost/api/preferences", {
          headers: { authorization: "Bearer token" },
        }),
      ),
    ).rejects.toBeInstanceOf(FirebaseAuthenticationError);
  });
});
