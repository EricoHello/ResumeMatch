import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const adminAppMocks = vi.hoisted(() => ({
  app: { name: "test-admin-app" },
  cert: vi.fn((serviceAccount: unknown) => ({ serviceAccount })),
  getApp: vi.fn(),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
}));

const fileMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: fileMocks.readFileSync,
}));

vi.mock("firebase-admin/app", () => ({
  cert: adminAppMocks.cert,
  getApp: adminAppMocks.getApp,
  getApps: adminAppMocks.getApps,
  initializeApp: adminAppMocks.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(),
}));

const SERVICE_ACCOUNT = {
  project_id: "resumematch-test",
  client_email: "firebase-admin@example.test",
  private_key: "line-one\\nline-two",
};

describe("Firebase Admin configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_FILE", "");
    adminAppMocks.getApps.mockReturnValue([]);
    adminAppMocks.getApp.mockReturnValue(adminAppMocks.app);
    adminAppMocks.initializeApp.mockReturnValue(adminAppMocks.app);
  });

  it("initializes lazily from Railway's JSON environment variable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      JSON.stringify(SERVICE_ACCOUNT),
    );
    const admin = await import("@/lib/firebase/admin");

    expect(adminAppMocks.initializeApp).not.toHaveBeenCalled();

    expect(admin.getFirebaseAdminApp()).toBe(adminAppMocks.app);
    expect(adminAppMocks.cert).toHaveBeenCalledWith({
      projectId: "resumematch-test",
      clientEmail: "firebase-admin@example.test",
      privateKey: "line-one\nline-two",
    });
    expect(adminAppMocks.initializeApp).toHaveBeenCalledWith({
      credential: {
        serviceAccount: {
          projectId: "resumematch-test",
          clientEmail: "firebase-admin@example.test",
          privateKey: "line-one\nline-two",
        },
      },
      projectId: "resumematch-test",
    });
  });

  it("fails closed when production credentials are absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_FILE",
      "/Users/developer/Downloads/service-account.json",
    );
    const { getFirebaseAdminApp } = await import("@/lib/firebase/admin");

    expect(() => getFirebaseAdminApp()).toThrow(
      "FIREBASE_SERVICE_ACCOUNT_JSON is required in production.",
    );
    expect(fileMocks.readFileSync).not.toHaveBeenCalled();
  });

  it("supports an explicit service-account file only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_FILE",
      "/Users/developer/Downloads/service-account.json",
    );
    fileMocks.readFileSync.mockReturnValue(JSON.stringify(SERVICE_ACCOUNT));
    const { getFirebaseAdminApp } = await import("@/lib/firebase/admin");

    expect(getFirebaseAdminApp()).toBe(adminAppMocks.app);
    expect(fileMocks.readFileSync).toHaveBeenCalledWith(
      "/Users/developer/Downloads/service-account.json",
      "utf8",
    );
    expect(adminAppMocks.cert).toHaveBeenCalledOnce();
  });

  it("prefers the explicit local file over a malformed inline value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{");
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_FILE",
      "/Users/developer/Downloads/service-account.json",
    );
    fileMocks.readFileSync.mockReturnValue(JSON.stringify(SERVICE_ACCOUNT));
    const { getFirebaseAdminApp } = await import("@/lib/firebase/admin");

    expect(getFirebaseAdminApp()).toBe(adminAppMocks.app);
    expect(fileMocks.readFileSync).toHaveBeenCalledWith(
      "/Users/developer/Downloads/service-account.json",
      "utf8",
    );
    expect(adminAppMocks.cert).toHaveBeenCalledWith({
      projectId: "resumematch-test",
      clientEmail: "firebase-admin@example.test",
      privateKey: "line-one\nline-two",
    });
  });

  it("supports Firebase emulators without loading service-account credentials", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    vi.stubEnv("FIREBASE_PROJECT_ID", "resumematch-emulator");
    const { getFirebaseAdminApp } = await import("@/lib/firebase/admin");

    expect(getFirebaseAdminApp()).toBe(adminAppMocks.app);
    expect(adminAppMocks.initializeApp).toHaveBeenCalledWith({
      projectId: "resumematch-emulator",
    });
    expect(adminAppMocks.cert).not.toHaveBeenCalled();
    expect(fileMocks.readFileSync).not.toHaveBeenCalled();
  });

  it("reuses an existing default Firebase Admin app", async () => {
    vi.stubEnv("NODE_ENV", "production");
    adminAppMocks.getApps.mockReturnValue([adminAppMocks.app]);
    const { getFirebaseAdminApp } = await import("@/lib/firebase/admin");

    expect(getFirebaseAdminApp()).toBe(adminAppMocks.app);
    expect(adminAppMocks.getApp).toHaveBeenCalledOnce();
    expect(adminAppMocks.initializeApp).not.toHaveBeenCalled();
  });
});
