import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-resumematch-tests";
const EMULATOR_HOSTS = new Set(["127.0.0.1:8085", "localhost:8085"]);
const ALICE_PREFERENCES_PATH = "users/alice/preferences/job";

let testEnvironment: RulesTestEnvironment;

function jobPreferences(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    targetLocation: "San Francisco, CA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"],
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
    minimumSalary: 125_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedJobPreferences(
  uid = "alice",
  overrides: Record<string, unknown> = {},
) {
  const createdAt = Timestamp.fromMillis(1_750_000_000_000);
  const data = {
    schemaVersion: 4,
    targetLocation: "San Francisco, CA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"],
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
    minimumSalary: 125_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}/preferences/job`), data);
  });

  return data;
}

describe("Firestore job-preference rules", () => {
  beforeAll(async () => {
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

    if (!emulatorHost || !EMULATOR_HOSTS.has(emulatorHost)) {
      throw new Error(
        "Firestore rules tests require the local emulator at 127.0.0.1:8085.",
      );
    }

    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(
          new URL("../../firestore.rules", import.meta.url),
          "utf8",
        ),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  it("allows an authenticated user to create, get, and update their job preferences", async () => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const preferenceRef = doc(aliceDb, ALICE_PREFERENCES_PATH);

    await assertSucceeds(setDoc(preferenceRef, jobPreferences()));

    const createdSnapshot = await assertSucceeds(getDoc(preferenceRef));
    const originalCreatedAt = createdSnapshot.get("createdAt") as Timestamp;
    expect(createdSnapshot.get("targetLocation")).toBe("San Francisco, CA");

    await assertSucceeds(
      updateDoc(preferenceRef, {
        targetLocation: "New York, NY",
        minimumSalary: 150_000,
        updatedAt: serverTimestamp(),
      }),
    );

    const updatedSnapshot = await assertSucceeds(getDoc(preferenceRef));
    expect(updatedSnapshot.get("targetLocation")).toBe("New York, NY");
    expect(updatedSnapshot.get("minimumSalary")).toBe(150_000);
    expect(
      (updatedSnapshot.get("createdAt") as Timestamp).isEqual(originalCreatedAt),
    ).toBe(true);
  });

  it("denies unauthenticated get, create, and update operations", async () => {
    await seedJobPreferences();
    const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
    const preferenceRef = doc(anonymousDb, ALICE_PREFERENCES_PATH);

    await assertFails(getDoc(preferenceRef));
    await assertFails(
      setDoc(
        doc(anonymousDb, "users/guest/preferences/job"),
        jobPreferences(),
      ),
    );
    await assertFails(
      updateDoc(preferenceRef, {
        targetLocation: "Seattle, WA",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies cross-user get, create, and update operations", async () => {
    await seedJobPreferences("bob");
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const bobPreferenceRef = doc(aliceDb, "users/bob/preferences/job");

    await assertFails(getDoc(bobPreferenceRef));
    await assertFails(
      setDoc(
        doc(aliceDb, "users/charlie/preferences/job"),
        jobPreferences(),
      ),
    );
    await assertFails(
      updateDoc(bobPreferenceRef, {
        minimumSalary: 140_000,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies list and delete operations, even for the owner", async () => {
    await seedJobPreferences();
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();

    await assertFails(
      getDocs(collection(aliceDb, "users/alice/preferences")),
    );
    await assertFails(deleteDoc(doc(aliceDb, ALICE_PREFERENCES_PATH)));
  });

  it.each([
    ["a missing required field", { updatedAt: undefined }],
    ["an unsupported schema version", { schemaVersion: 1 }],
    ["a non-string location", { targetLocation: 123 }],
    ["an empty location", { targetLocation: "" }],
    ["a location over 120 characters", { targetLocation: "x".repeat(121) }],
    ["a non-list additional location", { additionalLocations: "Seattle" }],
    ["too many additional locations", { additionalLocations: ["a", "b", "c", "d"] }],
    ["an empty additional location", { additionalLocations: [""] }],
    ["a duplicate primary location", { additionalLocations: ["San Francisco, CA"] }],
    ["duplicate additional locations", { additionalLocations: ["Oakland", "Oakland"] }],
    ["a radius below the minimum", { radiusMiles: 4 }],
    ["a radius above the maximum", { radiusMiles: 101 }],
    ["a non-integer radius", { radiusMiles: 25.5 }],
    ["a non-list work arrangement", { workArrangements: "remote" }],
    ["an unsupported work arrangement", { workArrangements: ["sometimes"] }],
    ["a duplicate work arrangement", { workArrangements: ["remote", "remote"] }],
    ["a non-list employment type", { employmentTypes: "full_time" }],
    ["an unsupported employment type", { employmentTypes: ["intern"] }],
    ["a duplicate employment type", { employmentTypes: ["full_time", "full_time"] }],
    ["a non-integer salary", { minimumSalary: 100_000.5 }],
    ["a negative salary", { minimumSalary: -1 }],
    ["a salary over the upper bound", { minimumSalary: 10_000_001 }],
    ["a non-USD currency", { salaryCurrency: "EUR" }],
    ["a non-year salary period", { salaryPeriod: "month" }],
    ["a non-timestamp createdAt", { createdAt: "today" }],
    ["a non-timestamp updatedAt", { updatedAt: "today" }],
  ])("denies create with %s", async (_description, override) => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const typedOverride: Record<string, unknown> = override;
    const data: Record<string, unknown> = jobPreferences(typedOverride);

    if ("updatedAt" in typedOverride && typedOverride.updatedAt === undefined) {
      delete data.updatedAt;
    }

    await assertFails(
      setDoc(doc(aliceDb, ALICE_PREFERENCES_PATH), data),
    );
  });

  it("denies client-supplied timestamps instead of write-time server timestamps", async () => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const timestamp = Timestamp.fromMillis(1_750_000_000_000);

    await assertFails(
      setDoc(
        doc(aliceDb, ALICE_PREFERENCES_PATH),
        jobPreferences({ createdAt: timestamp, updatedAt: timestamp }),
      ),
    );
  });

  it("denies extra preference fields, including future AI-generated fields", async () => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const preferenceRef = doc(aliceDb, ALICE_PREFERENCES_PATH);

    await assertFails(
      setDoc(
        preferenceRef,
        jobPreferences({
          resumeSummary: "AI-generated summary",
          skills: ["TypeScript"],
        }),
      ),
    );
  });

  it("denies removing required fields or adding extra fields during update", async () => {
    await seedJobPreferences();
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const preferenceRef = doc(aliceDb, ALICE_PREFERENCES_PATH);

    await assertFails(
      updateDoc(preferenceRef, {
        minimumSalary: null,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(preferenceRef, {
        searchKeywords: ["frontend engineer"],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("denies changing createdAt or omitting a fresh updatedAt during update", async () => {
    const seeded = await seedJobPreferences();
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const preferenceRef = doc(aliceDb, ALICE_PREFERENCES_PATH);

    await assertFails(
      updateDoc(preferenceRef, {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(preferenceRef, {
        targetLocation: "Austin, TX",
        updatedAt: seeded.updatedAt,
      }),
    );
  });

  it("denies all access to the reserved resumeProfiles hierarchy", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/alice/resumeProfiles/current"), {
        summary: "Reserved for future AI analysis",
      });
    });

    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const profileRef = doc(aliceDb, "users/alice/resumeProfiles/current");

    await assertFails(getDoc(profileRef));
    await assertFails(setDoc(profileRef, { summary: "Attempted write" }));
    await assertFails(deleteDoc(profileRef));
  });

  it("allows owners to read point totals and history but denies browser writes", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, "users/alice"), {
        points: {
          schemaVersion: 1,
          balance: 10,
          totalEarned: 15,
          totalSpent: 5,
          updatedAt: Timestamp.fromMillis(1_750_000_000_000),
        },
      });
      await setDoc(
        doc(firestore, "users/alice/pointHistory/award-1"),
        {
          schemaVersion: 1,
          kind: "earn",
          action: "test_action",
          amount: 15,
          description: "Test award",
          idempotencyKey: "test:award-1",
          timestamp: Timestamp.fromMillis(1_750_000_000_000),
        },
      );
    });

    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const userRef = doc(aliceDb, "users/alice");
    const entryRef = doc(aliceDb, "users/alice/pointHistory/award-1");

    await assertSucceeds(getDoc(userRef));
    await assertSucceeds(getDoc(entryRef));
    await assertSucceeds(
      getDocs(collection(aliceDb, "users/alice/pointHistory")),
    );
    await assertFails(
      updateDoc(userRef, { "points.balance": 10_000 }),
    );
    await assertFails(
      setDoc(doc(aliceDb, "users/alice/pointHistory/fake"), {
        amount: 10_000,
      }),
    );
    await assertFails(deleteDoc(entryRef));
  });

  it("denies guest and cross-user reads of point data", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/alice"), {
        points: {
          schemaVersion: 1,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          updatedAt: Timestamp.fromMillis(1_750_000_000_000),
        },
      });
      await setDoc(
        doc(context.firestore(), "users/alice/pointHistory/award-1"),
        { amount: 10 },
      );
    });

    const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
    const bobDb = testEnvironment.authenticatedContext("bob").firestore();

    await assertFails(getDoc(doc(anonymousDb, "users/alice")));
    await assertFails(
      getDocs(collection(anonymousDb, "users/alice/pointHistory")),
    );
    await assertFails(getDoc(doc(bobDb, "users/alice")));
    await assertFails(
      getDocs(collection(bobDb, "users/alice/pointHistory")),
    );
  });

  it("keeps job-click reward eligibility server-only", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(
          context.firestore(),
          "users/alice/pointRewardEligibility/search-123",
        ),
        {
          schemaVersion: 1,
          clickTokenHashes: ["a".repeat(64)],
          createdAt: Timestamp.fromMillis(1_750_000_000_000),
          expiresAt: Timestamp.fromMillis(1_750_086_400_000),
        },
      );
    });

    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();
    const eligibilityRef = doc(
      aliceDb,
      "users/alice/pointRewardEligibility/search-123",
    );

    await assertFails(getDoc(eligibilityRef));
    await assertFails(
      setDoc(
        doc(
          aliceDb,
          "users/alice/pointRewardEligibility/invented-search",
        ),
        { clickTokenHashes: ["fake"] },
      ),
    );
    await assertFails(deleteDoc(eligibilityRef));
  });

  it("denies documents outside the explicitly allowed preference path", async () => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();

    await assertFails(setDoc(doc(aliceDb, "users/alice"), { displayName: "Alice" }));
    await assertFails(setDoc(doc(aliceDb, "unrelated/document"), { allowed: true }));
  });
});
