// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResumeAnalysis } from "@/components/resume-analysis";

const PROFILE = {
  summary: "Senior platform engineer focused on reliable distributed systems.",
  skills: ["TypeScript", "Distributed systems"],
  experienceLevel: "senior" as const,
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer"],
  searchKeywords: ["platform engineering", "TypeScript"],
  preferences: {
    targetLocation: "Seattle, WA",
    minimumSalary: 145000,
  },
};

describe("ResumeAnalysis", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("announces analysis progress", () => {
    render(
      <ResumeAnalysis state={{ status: "loading" }} onRetry={vi.fn()} />,
    );

    expect(
      screen.getByRole("heading", { name: "Analyzing your resume" }),
    ).toBeTruthy();
    expect(screen.getByText("Step 3 of 3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Gemini is analyzing your resume…",
    );
    expect(
      screen.getByRole("progressbar", { name: "Resume analysis progress" }),
    ).toBeTruthy();
  });

  it("shows a safe error and exposes a retry action", () => {
    const onRetry = vi.fn();
    render(
      <ResumeAnalysis
        state={{
          status: "error",
          message: "The analysis service is temporarily unavailable.",
        }}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Couldn’t analyze your resume" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The analysis service is temporarily unavailable.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try analysis again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("honors Retry-After before enabling another analysis request", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(
      <ResumeAnalysis
        state={{
          status: "error",
          message: "Resume analysis has reached its current quota.",
          retryAfterSeconds: 1,
        }}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", {
      name: "Try analysis again",
    }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(true);
    expect(screen.getByText("Try again in 1 second.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));

    expect(retryButton.disabled).toBe(false);
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the structured success state without starting job search", () => {
    const { container } = render(
      <ResumeAnalysis
        state={{ status: "success", profile: PROFILE }}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Your resume is ready for the next step",
      }),
    ).toBeTruthy();
    expect(container.querySelector(".analysis-check")?.textContent).toBe("✓");
    expect(screen.getByRole("status").textContent).toContain(
      "Next: finding relevant jobs.",
    );
    expect(
      screen.getByRole("heading", { name: "Resume profile preview" }),
    ).toBeTruthy();
    expect(screen.getByText(PROFILE.summary)).toBeTruthy();
    expect(screen.getByText("$145,000 / year")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Skills" }).textContent).toContain(
      "TypeScript",
    );
    expect(
      screen.queryByRole("button", {
        name: /find (?:relevant )?jobs|search jobs|view job matches/i,
      }),
    ).toBeNull();
  });
});
