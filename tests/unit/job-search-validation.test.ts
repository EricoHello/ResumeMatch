import { describe, expect, it } from "vitest";

import { parseSearchJobsRequest } from "@/lib/jobs/validation";

const PROFILE = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
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
    { profile: { ...PROFILE, targetRoles: [] } },
    { profile: { ...PROFILE, preferences: { targetLocation: "Seattle" } } },
    { profile: { ...PROFILE, uid: "untrusted" } },
  ])("rejects invalid or extra job-search input", (input) => {
    expect(() => parseSearchJobsRequest(input)).toThrow();
  });
});
