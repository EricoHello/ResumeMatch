// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/resume-match-app", () => ({
  ResumeMatchApp: () => <div>Full ResumeMatch application</div>,
}));
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

import Home from "@/app/page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("maintenance page", () => {
  it("replaces the application when MAINTENANCE_MODE is true", () => {
    vi.stubEnv("MAINTENANCE_MODE", "true");

    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Currently in development" }),
    ).toBeTruthy();
    expect(screen.getByText("ResumeMatch will be available soon")).toBeTruthy();
    expect(screen.queryByText("Full ResumeMatch application")).toBeNull();
  });

  it("keeps the application available when MAINTENANCE_MODE is false", () => {
    vi.stubEnv("MAINTENANCE_MODE", "false");

    render(<Home />);

    expect(screen.getByText("Full ResumeMatch application")).toBeTruthy();
  });
});
