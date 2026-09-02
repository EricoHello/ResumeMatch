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
const pointMocks = vi.hoisted(() => ({
  awardGuest: vi.fn(),
  awardSignedIn: vi.fn(),
}));

vi.mock("@/lib/jobs/client", () => ({
  searchJobs: clientMocks.searchJobs,
  JobSearchClientError: clientMocks.TestJobSearchClientError,
}));

vi.mock("@/lib/points/job-click-client", () => ({
  awardGuestJobClick: pointMocks.awardGuest,
  awardSignedInJobClick: pointMocks.awardSignedIn,
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
    workArrangements: ["remote", "hybrid", "in_person"] as const,
    employmentTypes: ["contract", "full_time", "part_time", "seasonal"] as const,
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
const REWARD_CONTEXT = {
  searchId: "search-123",
  clickTokens: ["token-one", "token-two", "token-three"],
};
const GUEST_IDENTITY = { kind: "guest" as const };

describe("JobSearch", () => {
  beforeEach(() => {
    clientMocks.searchJobs.mockReset();
    pointMocks.awardGuest.mockReset().mockReturnValue({
      points: { balance: 10, totalEarned: 10, totalSpent: 0 },
      clickAwarded: true,
      bonusAwarded: false,
    });
    pointMocks.awardSignedIn.mockReset();
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
    let resolveSearch: (result: {
      jobs: typeof JOBS;
      rewardContext: typeof REWARD_CONTEXT;
    }) => void = () => {};
    clientMocks.searchJobs.mockImplementation(
      () =>
        new Promise<{
          jobs: typeof JOBS;
          rewardContext: typeof REWARD_CONTEXT;
        }>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    render(<JobSearch profile={PROFILE} identity={GUEST_IDENTITY} />);

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

    await act(async () =>
      resolveSearch({ jobs: JOBS, rewardContext: REWARD_CONTEXT }),
    );

    expect(screen.getByRole("heading", { name: "3 relevant jobs found" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Relevant job matches" }).children).toHaveLength(3);
    expect(screen.getByText("Salary not listed")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /view & apply/i })).toHaveLength(3);
  });

  it("awards the matching displayed job and reports earned points", async () => {
    const onPointsAwarded = vi.fn();
    clientMocks.searchJobs.mockResolvedValue({
      jobs: JOBS,
      rewardContext: REWARD_CONTEXT,
    });
    render(
      <JobSearch
        profile={PROFILE}
        identity={GUEST_IDENTITY}
        onPointsAwarded={onPointsAwarded}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find 3 job matches" }));

    const links = await screen.findAllByRole("link", { name: /view & apply/i });
    fireEvent.click(links[1]);

    expect(pointMocks.awardGuest).toHaveBeenCalledOnce();
    expect(pointMocks.awardGuest).toHaveBeenCalledWith(REWARD_CONTEXT, 1);
    expect(screen.getByText("+10 pts")).toBeTruthy();
    expect(onPointsAwarded).toHaveBeenCalledOnce();
    expect(onPointsAwarded).toHaveBeenCalledWith({
      points: { balance: 10, totalEarned: 10, totalSpent: 0 },
      clickAwarded: true,
      bonusAwarded: false,
    });
  });

  it("shows a safe retry action after a failed search", async () => {
    clientMocks.searchJobs.mockRejectedValue(
      new clientMocks.TestJobSearchClientError("Search is temporarily unavailable."),
    );
    render(<JobSearch profile={PROFILE} identity={GUEST_IDENTITY} />);
    fireEvent.click(screen.getByRole("button", { name: "Find 3 job matches" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search is temporarily unavailable.",
    );
    expect(screen.getByRole("button", { name: "Try job search again" })).toBeTruthy();
  });

  it("uses the relevant-jobs empty state only for an empty ranked response", async () => {
    clientMocks.searchJobs.mockResolvedValue({ jobs: [], rewardContext: null });
    render(<JobSearch profile={PROFILE} identity={GUEST_IDENTITY} />);
    fireEvent.click(screen.getByRole("button", { name: "Find 3 job matches" }));

    expect(
      await screen.findByRole("heading", { name: "No relevant jobs found" }),
    ).toBeTruthy();
    expect(screen.queryByText(/no strong matches/i)).toBeNull();
  });
});
