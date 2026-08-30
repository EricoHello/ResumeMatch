import { describe, expect, it } from "vitest";

import type { ResumeProfile } from "@/lib/analysis/types";
import {
  rankJobCandidates,
  rankJobCandidatesWithDiagnostics,
} from "@/lib/jobs/ranking";
import type { JobCandidate } from "@/lib/jobs/types";

const PROFILE: ResumeProfile = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Kubernetes", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["platform engineering", "cloud infrastructure"],
  preferences: {
    targetLocation: "Seattle, WA",
    minimumSalary: 145_000,
  },
};

function candidate(
  id: string,
  overrides: Partial<JobCandidate> = {},
): JobCandidate {
  return {
    id,
    title: "Staff Software Engineer",
    company: `Company ${id}`,
    location: "Seattle, WA",
    salary: "$160,000–$190,000 / year",
    applyUrl: `https://jobs.example.test/${id}`,
    postedAt: "2 days ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: [],
    description: "Build TypeScript distributed systems on Kubernetes.",
    minimumSalary: 160_000,
    maximumSalary: 190_000,
    salaryPeriod: "year",
    postedTimestamp: Date.UTC(2026, 7, 28) / 1_000,
    ...overrides,
  };
}

describe("rankJobCandidates", () => {
  const now = Date.UTC(2026, 7, 30);

  it("returns only the three strongest unique matches", () => {
    const matches = rankJobCandidates(
      [
        candidate("strong"),
        candidate("platform", { title: "Senior Platform Engineer" }),
        candidate("missing-pay", {
          title: "Staff Backend Engineer",
          salary: null,
          minimumSalary: null,
          maximumSalary: null,
        }),
        candidate("unrelated", {
          title: "Retail Sales Associate",
          location: "Miami, FL",
          description: "Customer sales and point of sale support.",
        }),
        candidate("duplicate", { company: "Company strong" }),
      ],
      PROFILE,
      now,
    );

    expect(matches).toHaveLength(3);
    expect(matches.map((job) => job.id)).toContain("missing-pay");
    expect(matches.map((job) => job.id)).not.toContain("unrelated");
    expect(matches[0].matchedSkills).toContain("TypeScript");
  });

  it("keeps missing salary neutral while demoting known below-minimum pay", () => {
    const matches = rankJobCandidates(
      [
        candidate("below", {
          minimumSalary: 90_000,
          maximumSalary: 110_000,
          salary: "$90,000–$110,000 / year",
        }),
        candidate("unknown", {
          salary: null,
          minimumSalary: null,
          maximumSalary: null,
        }),
      ],
      PROFILE,
      now,
    );

    expect(matches.map((job) => job.id)).toEqual(["unknown", "below"]);
    expect(matches[0].salary).toBeNull();
  });

  it("annualizes hourly compensation for minimum-salary ranking", () => {
    const matches = rankJobCandidates(
      [
        candidate("qualified-hourly", {
          minimumSalary: 75,
          maximumSalary: 90,
          salaryPeriod: "hour",
        }),
        candidate("low-hourly", {
          minimumSalary: 40,
          maximumSalary: 50,
          salaryPeriod: "hour",
        }),
      ],
      PROFILE,
      now,
    );
    expect(matches.map((job) => job.id)).toEqual([
      "qualified-hourly",
      "low-hourly",
    ]);
  });

  it("returns a reasonably related imperfect job without a score threshold", () => {
    const productProfile: ResumeProfile = {
      ...PROFILE,
      skills: ["Roadmaps", "Agile"],
      recentJobTitles: ["Product Manager"],
      targetRoles: ["Senior Product Manager"],
      searchKeywords: ["product strategy"],
      preferences: { targetLocation: "Remote", minimumSalary: 180_000 },
    };
    const imperfect = candidate("imperfect", {
      title: "Product Owner",
      company: "Different Industry",
      location: "Chicago, IL",
      salary: "$90,000 / year",
      minimumSalary: 90_000,
      maximumSalary: 90_000,
      description: "Own a product backlog and coordinate delivery.",
      postedAt: "2 months ago",
      postedTimestamp: now / 1_000 - 60 * 86_400,
    });

    expect(rankJobCandidates([imperfect], productProfile, now)).toEqual([
      expect.objectContaining({ id: "imperfect", title: "Product Owner" }),
    ]);
  });

  it("filters only clearly unrelated openings and reports ranking diagnostics", () => {
    const result = rankJobCandidatesWithDiagnostics(
      [
        candidate("relevant"),
        candidate("unrelated", {
          title: "Dental Hygienist",
          description: "Patient dental care and x-rays.",
          location: "Boise, ID",
          minimumSalary: null,
          maximumSalary: null,
        }),
      ],
      PROFILE,
      now,
    );

    expect(result.jobs).toHaveLength(1);
    expect(result.remainingAfterFiltering).toBe(1);
    expect(result.topRanked).toEqual([
      expect.objectContaining({ title: "Staff Software Engineer" }),
    ]);
  });
});
