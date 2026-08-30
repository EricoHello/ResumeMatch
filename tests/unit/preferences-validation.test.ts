import { describe, expect, it } from "vitest";

import {
  MAX_MINIMUM_SALARY,
  MAX_TARGET_LOCATION_LENGTH,
  parseJobPreferences,
  PreferencesValidationError,
} from "@/lib/preferences/validation";

describe("parseJobPreferences", () => {
  it("normalizes a valid preference payload", () => {
    expect(
      parseJobPreferences({
        targetLocation: "  San Francisco, CA  ",
        minimumSalary: 150_000,
      }),
    ).toEqual({
      targetLocation: "San Francisco, CA",
      minimumSalary: 150_000,
    });
  });

  it.each([
    null,
    [],
    "Seattle",
    { targetLocation: "Seattle" },
    { minimumSalary: 100_000 },
    {
      targetLocation: "Seattle",
      minimumSalary: 100_000,
      uid: "attacker-controlled",
    },
    {
      targetLocation: "Seattle",
      minimumSalary: 100_000,
      resumeSummary: "Untrusted AI field",
    },
    {
      targetLocation: "Seattle",
      minimumSalary: 100_000,
      skills: ["TypeScript"],
    },
  ])("rejects a non-exact payload: %j", (payload) => {
    expect(() => parseJobPreferences(payload)).toThrow(
      PreferencesValidationError,
    );
  });

  it.each([
    "",
    "   ",
    42,
    "x".repeat(MAX_TARGET_LOCATION_LENGTH + 1),
  ])("rejects invalid target locations", (targetLocation) => {
    expect(() =>
      parseJobPreferences({ targetLocation, minimumSalary: 100_000 }),
    ).toThrow(PreferencesValidationError);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_MINIMUM_SALARY + 1,
    "100000",
  ])("rejects invalid minimum salaries", (minimumSalary) => {
    expect(() =>
      parseJobPreferences({ targetLocation: "Remote", minimumSalary }),
    ).toThrow(PreferencesValidationError);
  });

  it("accepts boundary values", () => {
    expect(
      parseJobPreferences({ targetLocation: "x", minimumSalary: 0 }),
    ).toEqual({ targetLocation: "x", minimumSalary: 0 });

    const targetLocation = "x".repeat(MAX_TARGET_LOCATION_LENGTH);

    expect(
      parseJobPreferences({
        targetLocation,
        minimumSalary: MAX_MINIMUM_SALARY,
      }),
    ).toEqual({ targetLocation, minimumSalary: MAX_MINIMUM_SALARY });
  });
});
