import { describe, expect, it } from "vitest";

import { parseSearchJobsRequest } from "@/lib/jobs/validation";

const PROFILE = {
  summary: "Senior platform engineer.",
  resumeImprovement:
    "The resume is coherent; make one platform outcome more specific. Build a TypeScript reliability dashboard to reinforce the target roles.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangements: ["remote", "hybrid", "in_person"],
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"],
    minimumSalary: 145_000,
  },
};

describe("parseSearchJobsRequest", () => {
  it("accepts and normalizes an exact AI profile", () => {
    expect(
      parseSearchJobsRequest({
        profile: {
          ...PROFILE,
          summary: `  ${PROFILE.summary}  `,
          targetRoles: ["  Staff Software Engineer  ", "Platform Engineer"],
        },
      }),
    ).toEqual({ profile: PROFILE });
  });

  it.each([
    null,
    {},
    { profile: PROFILE, resumeText: "must not be sent" },
    { profile: { ...PROFILE, resumeImprovement: undefined } },
    { profile: { ...PROFILE, targetRoles: [] } },
    { profile: { ...PROFILE, preferences: { targetLocation: "Seattle" } } },
    { profile: { ...PROFILE, uid: "untrusted" } },
  ])("rejects invalid or extra job-search input", (input) => {
    expect(() => parseSearchJobsRequest(input)).toThrow();
  });
});
