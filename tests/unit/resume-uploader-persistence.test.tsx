// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResumeUploader } from "@/components/resume-uploader";

describe("ResumeUploader saved resume state", () => {
  afterEach(cleanup);

  it("shows a loaded account resume with an explicit replacement action", () => {
    const onResultChange = vi.fn();
    render(
      <ResumeUploader
        initialResult={{
          fileName: "Saved resume",
          fileType: "pdf",
          text: "Saved extracted resume text for a senior software engineer.",
          characterCount: 60,
          warnings: [],
        }}
        initialResultIsSaved
        useReplaceLabel
        onResultChange={onResultChange}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Your saved resume" }),
    ).toBeTruthy();
    expect(screen.getByText("Loaded from your account")).toBeTruthy();
    expect(screen.getByText("Saved to your account")).toBeTruthy();
    expect(
      screen.getByLabelText("Extracted resume text").textContent,
    ).toContain("Saved extracted resume text");

    fireEvent.click(screen.getByRole("button", { name: "Replace resume" }));

    expect(
      screen.getByRole("heading", { name: "Upload your resume" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Upload resume")).toBeTruthy();
    expect(onResultChange).toHaveBeenLastCalledWith(null);
  });
});
