import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => {
  class TestFirebaseAuthenticationError extends Error {}
  return { authenticate: vi.fn(), TestFirebaseAuthenticationError };
});
const repositoryMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setArchived: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  authenticateFirebaseRequest: authMocks.authenticate,
  FirebaseAuthenticationError: authMocks.TestFirebaseAuthenticationError,
}));

vi.mock("@/lib/applications/repository", () => ({
  applicationsRepository: repositoryMocks,
  ApplicationNotFoundError: class TestApplicationNotFoundError extends Error {},
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/applications/route";

const USER_ID = "verified-user";
const INPUT = {
  title: "Staff Software Engineer",
  company: "Northstar",
  location: "Seattle, WA",
  salary: "$160,000 / year",
  jobUrl: "https://jobs.example.test/one",
  source: "JSearch",
  sourceJobId: "one",
  origin: "resumematch" as const,
  status: "Applying" as const,
  appliedDate: null,
  notes: "",
  nextAction: null,
  nextActionDate: null,
};
const APPLICATION = {
  id: "url_hash",
  ...INPUT,
  dateAdded: "2026-09-02T18:00:00.000Z",
  lastUpdated: "2026-09-02T18:00:00.000Z",
  lastActivityAt: "2026-09-02T18:00:00.000Z",
  archived: false,
  archivedAt: null,
  archiveReason: null,
};

function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  contentType = "application/json",
) {
  const headers = new Headers({ authorization: "Bearer test-token" });
  if (method !== "GET") headers.set("content-type", contentType);
  return new Request("http://localhost/api/applications", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.authenticate.mockResolvedValue(USER_ID);
    repositoryMocks.list.mockResolvedValue([APPLICATION]);
    repositoryMocks.create.mockResolvedValue({
      application: APPLICATION,
      created: true,
    });
    repositoryMocks.update.mockResolvedValue({
      ...APPLICATION,
      status: "Applied",
      appliedDate: "2026-09-02",
    });
    repositoryMocks.setArchived.mockResolvedValue({
      ...APPLICATION,
      archived: true,
      archivedAt: "2026-09-02T19:00:00.000Z",
      archiveReason: "manual",
    });
    repositoryMocks.delete.mockResolvedValue(undefined);
  });

  it("lists only the verified user's tracker", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { applications: [APPLICATION] },
    });
    expect(repositoryMocks.list).toHaveBeenCalledWith(USER_ID);
  });

  it("creates a normalized application and reports a new resource", async () => {
    const response = await POST(
      request("POST", { ...INPUT, title: "  Staff Software Engineer  " }),
    );

    expect(response.status).toBe(201);
    expect(repositoryMocks.create).toHaveBeenCalledWith(USER_ID, INPUT);
    await expect(response.json()).resolves.toEqual({
      data: { application: APPLICATION, created: true },
    });
  });

  it("returns 200 for a duplicate URL without creating another entry", async () => {
    repositoryMocks.create.mockResolvedValue({
      application: { ...APPLICATION, status: "Interview" },
      created: false,
    });

    const response = await POST(request("POST", INPUT));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { created: false, application: { status: "Interview" } },
    });
  });

  it("updates only supported tracker fields", async () => {
    const response = await PATCH(
      request("PATCH", {
        applicationId: APPLICATION.id,
        updates: { status: "Applied", notes: "Submitted" },
      }),
    );

    expect(response.status).toBe(200);
    expect(repositoryMocks.update).toHaveBeenCalledWith(USER_ID, APPLICATION.id, {
      status: "Applied",
      notes: "Submitted",
    });
  });

  it("archives separately from application status", async () => {
    const response = await PATCH(
      request("PATCH", {
        applicationId: APPLICATION.id,
        archived: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(repositoryMocks.setArchived).toHaveBeenCalledWith(
      USER_ID,
      APPLICATION.id,
      true,
    );
    expect(repositoryMocks.update).not.toHaveBeenCalled();
  });

  it("permanently deletes a verified user's selected application", async () => {
    const response = await DELETE(
      request("DELETE", { applicationId: APPLICATION.id }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { deleted: true, applicationId: APPLICATION.id },
    });
    expect(repositoryMocks.delete).toHaveBeenCalledWith(
      USER_ID,
      APPLICATION.id,
    );
  });

  it("rejects unknown fields before touching Firestore", async () => {
    const response = await POST(
      request("POST", { ...INPUT, uid: "another-user" }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_APPLICATION" },
    });
    expect(repositoryMocks.create).not.toHaveBeenCalled();
  });

  it("rejects guests without reading application data", async () => {
    authMocks.authenticate.mockRejectedValue(
      new authMocks.TestFirebaseAuthenticationError(),
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(repositoryMocks.list).not.toHaveBeenCalled();
  });

  it("rejects non-JSON writes as malformed requests", async () => {
    const response = await POST(request("POST", INPUT, "text/plain"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(repositoryMocks.create).not.toHaveBeenCalled();
  });

  it("rejects oversized writes before validation or persistence", async () => {
    const response = await POST(
      request("POST", { ...INPUT, notes: "x".repeat(20_000) }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The application request is too large.",
      },
    });
    expect(repositoryMocks.create).not.toHaveBeenCalled();
  });
});
