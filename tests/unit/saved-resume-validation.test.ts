import { describe, expect, it } from "vitest";

import {
  parseSavedResume,
  SavedResumeValidationError,
} from "@/lib/resume/saved-validation";

const PREFERENCES = {
  targetLocation: "Seattle, WA",
  additionalLocations: [],
  radiusMiles: 25,
  workArrangements: ["hybrid"],
  employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
  minimumSalary: 140_000,
};

const PROFILE = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Kubernetes"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: PREFERENCES,
};

describe("parseSavedResume", () => {
  it("normalizes extracted text and a complete candidate profile", () => {
    expect(
      parseSavedResume({
        resumeText: "  Ada Lovelace\r\nSenior platform engineer with TypeScript.  ",
        profile: PROFILE,
      }),
    ).toEqual({
      resumeText: "Ada Lovelace\nSenior platform engineer with TypeScript.",
      profile: PROFILE,
    });
  });

  it("accepts parsed resume text before analysis has completed", () => {
    expect(
      parseSavedResume({
        resumeText: "Readable extracted resume text for a software engineer.",
        profile: null,
      }),
    ).toMatchObject({ profile: null });
  });

  it.each([
    null,
    {},
    { resumeText: "Readable extracted resume text.", profile: null, uid: "bad" },
    { resumeText: "too short", profile: null },
    { resumeText: "Readable extracted resume text.", profile: {} },
    {
      resumeText: "Readable extracted resume text.",
      profile: { ...PROFILE, privateField: "bad" },
    },
  ])("rejects invalid or extra saved-resume data: %j", (value) => {
    expect(() => parseSavedResume(value)).toThrow(SavedResumeValidationError);
  });
});
