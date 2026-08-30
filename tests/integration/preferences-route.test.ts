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

vi.mock("@/lib/preferences/repository", () => ({
  preferencesRepository: repositoryMocks,
}));

import { GET, PUT } from "@/app/api/preferences/route";

const VERIFIED_UID = "verified-firebase-user";
const PREFERENCES = {
  targetLocation: "Austin, TX",
  minimumSalary: 110_000,
};

function apiRequest(
  method: "GET" | "PUT",
  options: { body?: string; contentType?: string } = {},
) {
  const headers = new Headers({ authorization: "Bearer test-id-token" });

  if (options.contentType) {
    headers.set("content-type", options.contentType);
  }

  return new Request("http://localhost/api/preferences", {
    method,
    headers,
    body: options.body,
  });
}

describe("GET /api/preferences", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset();
    repositoryMocks.get.mockReset();
    repositoryMocks.save.mockReset();
    authMocks.authenticate.mockResolvedValue(VERIFIED_UID);
  });

  it("loads preferences using only the verified UID", async () => {
    repositoryMocks.get.mockResolvedValue(PREFERENCES);

    const response = await GET(apiRequest("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { preferences: PREFERENCES },
    });
    expect(repositoryMocks.get).toHaveBeenCalledOnce();
    expect(repositoryMocks.get).toHaveBeenCalledWith(VERIFIED_UID);
  });

  it("returns a successful null result for a first-time user", async () => {
    repositoryMocks.get.mockResolvedValue(null);

    const response = await GET(apiRequest("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { preferences: null },
    });
  });

  it("rejects unauthenticated requests without touching Firestore", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await GET(apiRequest("GET"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in to load your job preferences.",
      },
    });
    expect(repositoryMocks.get).not.toHaveBeenCalled();
  });

  it("reports authentication infrastructure failures without calling Firestore", async () => {
    authMocks.authenticate.mockRejectedValue(
      new Error("private service-account configuration detail"),
    );

    const response = await GET(apiRequest("GET"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "We couldn't verify your sign-in right now. Please try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("service-account");
    expect(repositoryMocks.get).not.toHaveBeenCalled();
  });

  it("does not expose repository error details", async () => {
    repositoryMocks.get.mockRejectedValue(
      new Error("private-key-and-firestore-internals"),
    );

    const response = await GET(apiRequest("GET"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "PREFERENCES_UNAVAILABLE",
        message: "We couldn't load your job preferences. Please try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-key");
  });
});

describe("PUT /api/preferences", () => {
  beforeEach(() => {
    authMocks.authenticate.mockReset();
    repositoryMocks.get.mockReset();
    repositoryMocks.save.mockReset();
    authMocks.authenticate.mockResolvedValue(VERIFIED_UID);
    repositoryMocks.save.mockImplementation(
      async (_userId: string, preferences: typeof PREFERENCES) => preferences,
    );
  });

  it("normalizes and saves preferences under only the verified UID", async () => {
    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          targetLocation: "  Austin, TX  ",
          minimumSalary: 110_000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { preferences: PREFERENCES },
    });
    expect(repositoryMocks.save).toHaveBeenCalledWith(
      VERIFIED_UID,
      PREFERENCES,
    );
  });

  it.each([
    ["uid", "another-user"],
    ["resumeSummary", "injected summary"],
    ["skills", ["injected skill"]],
    ["targetRoles", ["injected role"]],
  ])("rejects an extra %s field", async (field, value) => {
    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json",
        body: JSON.stringify({ ...PREFERENCES, [field]: value }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_PREFERENCES" },
    });
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json",
        body: "{not valid json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The request body must contain valid JSON.",
      },
    });
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("rejects non-JSON request bodies", async () => {
    const response = await PUT(
      apiRequest("PUT", {
        contentType: "text/plain",
        body: JSON.stringify(PREFERENCES),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests without reading or saving the body", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json",
        body: JSON.stringify(PREFERENCES),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("returns a safe 503 when authentication infrastructure is unavailable", async () => {
    authMocks.authenticate.mockRejectedValue(
      new Error("private verifier outage detail"),
    );

    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json",
        body: JSON.stringify(PREFERENCES),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "We couldn't verify your sign-in right now. Please try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("verifier outage");
    expect(repositoryMocks.save).not.toHaveBeenCalled();
  });

  it("does not expose repository error details", async () => {
    repositoryMocks.save.mockRejectedValue(
      new Error("service-account-secret-and-firestore-internals"),
    );

    const response = await PUT(
      apiRequest("PUT", {
        contentType: "application/json",
        body: JSON.stringify(PREFERENCES),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "PREFERENCES_UNAVAILABLE",
        message: "We couldn't save your job preferences. Please try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("service-account");
  });
});
