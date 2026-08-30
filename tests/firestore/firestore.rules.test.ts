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
    schemaVersion: 1,
    targetLocation: "San Francisco, CA",
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
    schemaVersion: 1,
    targetLocation: "San Francisco, CA",
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
    ["an unsupported schema version", { schemaVersion: 2 }],
    ["a non-string location", { targetLocation: 123 }],
    ["an empty location", { targetLocation: "" }],
    ["a location over 120 characters", { targetLocation: "x".repeat(121) }],
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

  it("denies documents outside the explicitly allowed preference path", async () => {
    const aliceDb = testEnvironment.authenticatedContext("alice").firestore();

    await assertFails(setDoc(doc(aliceDb, "users/alice"), { displayName: "Alice" }));
    await assertFails(setDoc(doc(aliceDb, "unrelated/document"), { allowed: true }));
  });
});
