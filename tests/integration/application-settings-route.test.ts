import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return { authenticate: vi.fn(), TestFirebaseAuthenticationError };
});
const settingsMocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));
vi.mock("@/lib/applications/settings-repository", () => ({
  applicationSettingsRepository: settingsMocks,
}));

import {
  GET,
  PUT,
} from "@/app/api/applications/settings/route";

const USER_ID = "verified-user";

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("http://localhost/api/applications/settings", {
    method,
    headers: {
      authorization: "Bearer token",
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/applications/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.authenticate.mockResolvedValue(USER_ID);
    settingsMocks.get.mockResolvedValue({ autoArchiveDays: 30 });
    settingsMocks.save.mockImplementation(async (_userId, settings) => settings);
  });

  it("loads the default or saved policy for the verified user", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { settings: { autoArchiveDays: 30 } },
    });
    expect(settingsMocks.get).toHaveBeenCalledWith(USER_ID);
  });

  it.each([14, 30, 60, 90, null])(
    "saves the supported %s-day policy",
    async (autoArchiveDays) => {
      const response = await PUT(request("PUT", { autoArchiveDays }));

      expect(response.status).toBe(200);
      expect(settingsMocks.save).toHaveBeenCalledWith(USER_ID, {
        autoArchiveDays,
      });
    },
  );

  it("rejects unsupported archive periods", async () => {
    const response = await PUT(request("PUT", { autoArchiveDays: 45 }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SETTINGS" },
    });
    expect(settingsMocks.save).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(settingsMocks.get).not.toHaveBeenCalled();
  });
});
