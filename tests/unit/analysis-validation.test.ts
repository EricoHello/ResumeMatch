import { describe, expect, it } from "vitest";

import {
  AnalysisValidationError,
  MAX_ANALYSIS_SKILLS,
  MAX_ANALYSIS_SUMMARY_LENGTH,
  MAX_RESUME_TEXT_LENGTH,
  parseAnalyzeResumeRequest,
  parseGeneratedResumeAnalysis,
} from "@/lib/analysis/validation";

const RESUME_TEXT = `Ada Lovelace\r\n  Senior Software Engineer\t\nTypeScript and distributed systems`;
const PREFERENCES = {
  targetLocation: "Seattle, WA",
  minimumSalary: 140_000,
};
const GENERATED_ANALYSIS = {
  summary: "Senior software engineer focused on distributed systems.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Distributed systems"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["TypeScript", "distributed systems"],
};

describe("parseAnalyzeResumeRequest", () => {
  it("normalizes resume text and preferences", () => {
    expect(
      parseAnalyzeResumeRequest({
        resumeText: RESUME_TEXT,
        preferences: {
          targetLocation: "  Seattle, WA  ",
          minimumSalary: 140_000,
        },
      }),
    ).toEqual({
      resumeText:
        "Ada Lovelace\nSenior Software Engineer\nTypeScript and distributed systems",
      preferences: PREFERENCES,
    });
  });

  it.each([
    null,
    [],
    { resumeText: RESUME_TEXT },
    { preferences: PREFERENCES },
    { resumeText: RESUME_TEXT, preferences: PREFERENCES, uid: "attacker" },
    { resumeText: "too short", preferences: PREFERENCES },
    {
      resumeText: "x".repeat(MAX_RESUME_TEXT_LENGTH + 1),
      preferences: PREFERENCES,
    },
    {
      resumeText: RESUME_TEXT,
      preferences: { ...PREFERENCES, minimumSalary: "140000" },
    },
  ])("rejects an invalid analysis request: %j", (request) => {
    expect(() => parseAnalyzeResumeRequest(request)).toThrow(
      AnalysisValidationError,
    );
  });
});

describe("parseGeneratedResumeAnalysis", () => {
  it("accepts only the output schema and normalizes duplicate list items", () => {
    expect(
      parseGeneratedResumeAnalysis({
        ...GENERATED_ANALYSIS,
        summary: `  ${GENERATED_ANALYSIS.summary}  `,
        skills: ["TypeScript", " typescript ", "Distributed systems"],
      }),
    ).toEqual(GENERATED_ANALYSIS);
  });

  it.each([
    null,
    { ...GENERATED_ANALYSIS, preferences: PREFERENCES },
    { ...GENERATED_ANALYSIS, experienceLevel: "principal" },
    {
      ...GENERATED_ANALYSIS,
      summary: "x".repeat(MAX_ANALYSIS_SUMMARY_LENGTH + 1),
    },
    {
      ...GENERATED_ANALYSIS,
      skills: Array.from({ length: MAX_ANALYSIS_SKILLS + 1 }, (_, index) =>
        `skill-${index}`,
      ),
    },
    { ...GENERATED_ANALYSIS, skills: ["TypeScript", ""] },
    { ...GENERATED_ANALYSIS, recentJobTitles: "Engineer" },
    { ...GENERATED_ANALYSIS, targetRoles: [] },
    { ...GENERATED_ANALYSIS, searchKeywords: [] },
    { ...GENERATED_ANALYSIS, searchKeywords: [42] },
  ])("rejects invalid generated output: %j", (output) => {
    expect(() => parseGeneratedResumeAnalysis(output)).toThrow(
      AnalysisValidationError,
    );
  });
});
