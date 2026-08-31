import { describe, expect, it } from "vitest";

import {
  DEFAULT_RADIUS_MILES,
  MAX_ADDITIONAL_LOCATIONS,
  MAX_MINIMUM_SALARY,
  MAX_RADIUS_MILES,
  MAX_TARGET_LOCATION_LENGTH,
  MIN_RADIUS_MILES,
  parseJobPreferences,
  PreferencesValidationError,
} from "@/lib/preferences/validation";

describe("parseJobPreferences", () => {
  it("normalizes a valid preference payload", () => {
    expect(
      parseJobPreferences({
        targetLocation: "  San Francisco, CA  ",
        additionalLocations: ["  Oakland, CA  "],
        radiusMiles: 50,
        workArrangements: ["hybrid", "remote"],
        employmentTypes: ["full_time", "contract"],
        minimumSalary: 150_000,
      }),
    ).toEqual({
      targetLocation: "San Francisco, CA",
      additionalLocations: ["Oakland, CA"],
      radiusMiles: 50,
      workArrangements: ["hybrid", "remote"],
      employmentTypes: ["full_time", "contract"],
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

  it("migrates legacy preferences with safe defaults", () => {
    expect(
      parseJobPreferences({ targetLocation: "x", minimumSalary: 0 }),
    ).toEqual({
      targetLocation: "x",
      additionalLocations: [],
      radiusMiles: DEFAULT_RADIUS_MILES,
      workArrangements: ["remote", "hybrid", "in_person"],
      employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
      minimumSalary: 0,
    });

    const targetLocation = "x".repeat(MAX_TARGET_LOCATION_LENGTH);

    expect(
      parseJobPreferences({
        targetLocation,
        minimumSalary: MAX_MINIMUM_SALARY,
      }),
    ).toEqual({
      targetLocation,
      additionalLocations: [],
      radiusMiles: DEFAULT_RADIUS_MILES,
      workArrangements: ["remote", "hybrid", "in_person"],
      employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
      minimumSalary: MAX_MINIMUM_SALARY,
    });
  });

  it("migrates earlier work-arrangement choices to enabled lists", () => {
    const base = {
      targetLocation: "Seattle",
      additionalLocations: [],
      radiusMiles: DEFAULT_RADIUS_MILES,
      employmentTypes: ["full_time"],
      minimumSalary: 100_000,
    };

    expect(
      parseJobPreferences({ ...base, workArrangement: "any" }).workArrangements,
    ).toEqual(["remote", "hybrid", "in_person"]);
    expect(
      parseJobPreferences({ ...base, workArrangement: "hybrid" })
        .workArrangements,
    ).toEqual(["hybrid"]);
  });

  it("allows every employment type to be disabled", () => {
    expect(
      parseJobPreferences({
        targetLocation: "Seattle",
        additionalLocations: [],
        radiusMiles: DEFAULT_RADIUS_MILES,
        workArrangements: ["remote", "hybrid", "in_person"],
        employmentTypes: [],
        minimumSalary: 100_000,
      }).employmentTypes,
    ).toEqual([]);
  });

  it("allows every work arrangement to be disabled", () => {
    expect(
      parseJobPreferences({
        targetLocation: "Seattle",
        additionalLocations: [],
        radiusMiles: DEFAULT_RADIUS_MILES,
        workArrangements: [],
        employmentTypes: ["full_time"],
        minimumSalary: 100_000,
      }).workArrangements,
    ).toEqual([]);
  });

  it.each([
    { additionalLocations: ["Portland", "Portland"] },
    { additionalLocations: ["Seattle"] },
    { additionalLocations: Array(MAX_ADDITIONAL_LOCATIONS + 1).fill("City") },
    { radiusMiles: MIN_RADIUS_MILES - 1 },
    { radiusMiles: MAX_RADIUS_MILES + 1 },
    { radiusMiles: 25.5 },
    { workArrangements: "remote" },
    { workArrangements: ["sometimes"] },
    { workArrangements: ["remote", "remote"] },
    { employmentTypes: "full_time" },
    { employmentTypes: ["intern"] },
    { employmentTypes: ["full_time", "full_time"] },
  ])("rejects invalid expanded filters: %j", (override) => {
    expect(() =>
      parseJobPreferences({
        targetLocation: "Seattle",
        additionalLocations: [],
        radiusMiles: DEFAULT_RADIUS_MILES,
        workArrangements: ["remote", "hybrid", "in_person"],
        employmentTypes: ["full_time"],
        minimumSalary: 100_000,
        ...override,
      }),
    ).toThrow(PreferencesValidationError);
  });
});
