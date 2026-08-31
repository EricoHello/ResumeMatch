// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => {
  class TestJobSearchClientError extends Error {
    constructor(
      message: string,
      readonly status: number | null = null,
      readonly retryAfterSeconds?: number,
    ) {
      super(message);
    }
  }
  return { searchJobs: vi.fn(), TestJobSearchClientError };
});

vi.mock("@/lib/jobs/client", () => ({
  searchJobs: clientMocks.searchJobs,
  JobSearchClientError: clientMocks.TestJobSearchClientError,
}));

import { JobSearch } from "@/components/job-search";

const PROFILE = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior" as const,
  skills: ["TypeScript"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangement: "any" as const,
    minimumSalary: 145_000,
  },
};
const JOBS = [
  {
    id: "one",
    title: "Staff Software Engineer",
    company: "Northstar",
    location: "Seattle, WA",
    salary: "$160,000–$190,000 / year",
    applyUrl: "https://jobs.example.test/one",
    postedAt: "2 days ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: ["TypeScript"],
  },
  {
    id: "two",
    title: "Platform Engineer",
    company: "Waypoint",
    location: "Remote",
    salary: null,
    applyUrl: "https://jobs.example.test/two",
    postedAt: null,
    employmentType: null,
    isRemote: true,
    matchedSkills: [],
  },
  {
    id: "three",
    title: "Senior Backend Engineer",
    company: "Atlas",
    location: "Bellevue, WA",
    salary: "$150,000 / year",
    applyUrl: "https://jobs.example.test/three",
    postedAt: "1 week ago",
    employmentType: "FULLTIME",
    isRemote: false,
    matchedSkills: ["TypeScript"],
  },
];

describe("JobSearch", () => {
  beforeEach(() => {
    clientMocks.searchJobs.mockReset();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("waits for an explicit action, shows progress, and renders three jobs", async () => {
    let resolveSearch: (jobs: typeof JOBS) => void = () => {};
    clientMocks.searchJobs.mockImplementation(
      () => new Promise<typeof JOBS>((resolve) => { resolveSearch = resolve; }),
    );
    render(<JobSearch profile={PROFILE} />);

    expect(screen.getByText("Step 4 of 4")).toBeTruthy();
    expect(clientMocks.searchJobs).not.toHaveBeenCalled();
    const start = screen.getByRole("button", { name: "Find 3 job matches" });
    fireEvent.click(start);
    fireEvent.click(start);

    expect(clientMocks.searchJobs).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Searching current jobs" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Job search progress" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Finding and ranking relevant openings",
    );

    await act(async () => resolveSearch(JOBS));

    expect(screen.getByRole("heading", { name: "3 relevant jobs found" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Relevant job matches" }).children).toHaveLength(3);
    expect(screen.getByText("Salary not listed")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /view & apply/i })).toHaveLength(3);
  });

  it("shows a safe retry action after a failed search", async () => {
    clientMocks.searchJobs.mockRejectedValue(
      new clientMocks.TestJobSearchClientError("Search is temporarily unavailable."),
    );
    render(<JobSearch profile={PROFILE} />);
    fireEvent.click(screen.getByRole("button", { name: "Find 3 job matches" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search is temporarily unavailable.",
    );
    expect(screen.getByRole("button", { name: "Try job search again" })).toBeTruthy();
  });

  it("uses the relevant-jobs empty state only for an empty ranked response", async () => {
    clientMocks.searchJobs.mockResolvedValue([]);
    render(<JobSearch profile={PROFILE} />);
    fireEvent.click(screen.getByRole("button", { name: "Find 3 job matches" }));

    expect(
      await screen.findByRole("heading", { name: "No relevant jobs found" }),
    ).toBeTruthy();
    expect(screen.queryByText(/no strong matches/i)).toBeNull();
  });
});
