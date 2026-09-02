import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const preferenceMocks = vi.hoisted(() => ({ get: vi.fn() }));
const resumeMocks = vi.hoisted(() => ({ get: vi.fn() }));
const privacyMocks = vi.hoisted(() => ({ get: vi.fn() }));
const pointsMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/preferences/repository", () => ({
  preferencesRepository: preferenceMocks,
}));

vi.mock("@/lib/resume/saved-repository", () => ({
  savedResumeRepository: resumeMocks,
}));

vi.mock("@/lib/privacy/repository", () => ({
  resumePrivacyRepository: privacyMocks,
}));

vi.mock("@/lib/points/repository", () => ({
  pointsRepository: pointsMocks,
}));

import { FirestoreAccountDataRepository } from "@/lib/account/repository";

const USER_ID = "verified-user";
const PREFERENCES = {
  targetLocation: "Seattle, WA",
  additionalLocations: [],
  radiusMiles: 25,
  workArrangements: ["remote"] as const,
  employmentTypes: ["full_time"] as const,
  minimumSalary: 120_000,
};
const PROFILE = {
  summary: "Software engineer building accessible products.",
  experienceLevel: "mid" as const,
  skills: ["TypeScript"],
  recentJobTitles: ["Software Engineer"],
  targetRoles: ["Senior Software Engineer"],
  searchKeywords: ["TypeScript"],
  preferences: PREFERENCES,
};
const POINTS = {
  points: { balance: 25, totalEarned: 40, totalSpent: 15 },
  history: [
    {
      id: "entry-1",
      kind: "earn" as const,
      action: "test_action",
      amount: 40,
      description: "Test award",
      timestamp: "2026-08-30T11:00:00.000Z",
    },
  ],
};

describe("FirestoreAccountDataRepository", () => {
  beforeEach(() => {
    preferenceMocks.get.mockReset();
    resumeMocks.get.mockReset();
    privacyMocks.get.mockReset();
    pointsMocks.get.mockReset();
    privacyMocks.get.mockResolvedValue({ saveResumeData: true });
    pointsMocks.get.mockResolvedValue(POINTS);
  });

  it("exports preferences, extracted text, and the AI profile", async () => {
    preferenceMocks.get.mockResolvedValue(PREFERENCES);
    resumeMocks.get.mockResolvedValue({
      resumeText: "Extracted resume text stored in Firestore.",
      profile: PROFILE,
    });
    const repository = new FirestoreAccountDataRepository(
      vi.fn() as never,
      () => new Date("2026-08-30T12:00:00.000Z"),
    );

    await expect(repository.export(USER_ID)).resolves.toEqual({
      schemaVersion: 3,
      generatedAt: "2026-08-30T12:00:00.000Z",
      data: {
        savedPreferences: PREFERENCES,
        extractedResumeText: "Extracted resume text stored in Firestore.",
        aiCandidateProfile: PROFILE,
        privacySettings: { saveResumeData: true },
        points: POINTS,
      },
    });
    expect(preferenceMocks.get).toHaveBeenCalledWith(USER_ID);
    expect(resumeMocks.get).toHaveBeenCalledWith(USER_ID);
    expect(pointsMocks.get).toHaveBeenCalledWith(USER_ID, {
      historyLimit: null,
    });
  });

  it("represents data that has not been saved with null values", async () => {
    preferenceMocks.get.mockResolvedValue(null);
    resumeMocks.get.mockResolvedValue(null);
    const repository = new FirestoreAccountDataRepository(
      vi.fn() as never,
      () => new Date("2026-08-30T12:00:00.000Z"),
    );

    await expect(repository.export(USER_ID)).resolves.toMatchObject({
      data: {
        savedPreferences: null,
        extractedResumeText: null,
        aiCandidateProfile: null,
        privacySettings: { saveResumeData: true },
        points: POINTS,
      },
    });
  });

  it("recursively deletes the verified user's complete document subtree", async () => {
    const userDocument = { path: `users/${USER_ID}` };
    const doc = vi.fn().mockReturnValue(userDocument);
    const collection = vi.fn().mockReturnValue({ doc });
    const recursiveDelete = vi.fn().mockResolvedValue(undefined);
    const getFirestore = vi.fn().mockReturnValue({
      collection,
      recursiveDelete,
    });
    const repository = new FirestoreAccountDataRepository(
      getFirestore as never,
    );

    await repository.delete(USER_ID);

    expect(collection).toHaveBeenCalledWith("users");
    expect(doc).toHaveBeenCalledWith(USER_ID);
    expect(recursiveDelete).toHaveBeenCalledOnce();
    expect(recursiveDelete).toHaveBeenCalledWith(userDocument);
  });
});
