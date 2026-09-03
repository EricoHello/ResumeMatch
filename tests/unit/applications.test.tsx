// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadSettings: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  delete: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/applications/client", () => ({
  loadApplications: clientMocks.load,
  loadApplicationSettings: clientMocks.loadSettings,
  createApplication: clientMocks.create,
  updateApplication: clientMocks.update,
  setApplicationArchived: clientMocks.archive,
  deleteApplication: clientMocks.delete,
  saveApplicationSettings: clientMocks.saveSettings,
}));

import { Applications } from "@/components/applications";

const USER = {
  uid: "firebase-user",
  getIdToken: vi.fn().mockResolvedValue("firebase-token"),
} as unknown as User;
const APPLICATION = {
  id: "application-one",
  title: "Staff Software Engineer",
  company: "Northstar",
  location: "Seattle, WA",
  salary: "$160,000 / year",
  jobUrl: "https://jobs.example.test/one",
  source: "JSearch",
  sourceJobId: "one",
  origin: "resumematch" as const,
  status: "Applying" as const,
  dateAdded: "2026-09-01T18:00:00.000Z",
  appliedDate: null,
  lastUpdated: "2026-09-01T18:00:00.000Z",
  lastActivityAt: "2026-09-01T18:00:00.000Z",
  notes: "",
  nextAction: null,
  nextActionDate: null,
  archived: false,
  archivedAt: null,
  archiveReason: null,
};

describe("Applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.load.mockResolvedValue([APPLICATION]);
    clientMocks.loadSettings.mockResolvedValue({ autoArchiveDays: 30 });
    clientMocks.update.mockImplementation(async (_user, _id, updates) => ({
      ...APPLICATION,
      ...updates,
      appliedDate: "2026-09-02",
      lastUpdated: "2026-09-02T18:00:00.000Z",
      lastActivityAt: "2026-09-02T18:00:00.000Z",
    }));
    clientMocks.create.mockImplementation(async (_user, input) => ({
      application: {
        id: "manual-application",
        ...input,
        dateAdded: "2026-09-02T18:00:00.000Z",
        lastUpdated: "2026-09-02T18:00:00.000Z",
        lastActivityAt: "2026-09-02T18:00:00.000Z",
        archived: false,
        archivedAt: null,
        archiveReason: null,
      },
      created: true,
    }));
    clientMocks.archive.mockImplementation(async (_user, _id, archived) => ({
      ...APPLICATION,
      archived,
      archivedAt: archived ? "2026-09-02T18:00:00.000Z" : null,
      archiveReason: archived ? "manual" : null,
      lastUpdated: "2026-09-02T18:00:00.000Z",
    }));
    clientMocks.delete.mockResolvedValue(undefined);
    clientMocks.saveSettings.mockImplementation(async (_user, settings) => settings);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows guests a sign-in prompt without loading or storing data", () => {
    const onGoogleSignIn = vi.fn();
    render(
      <Applications
        identity={{ kind: "guest" }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={onGoogleSignIn}
      />,
    );

    expect(screen.getByRole("heading", { name: "Sign in to track applications" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(onGoogleSignIn).toHaveBeenCalledOnce();
    expect(clientMocks.load).not.toHaveBeenCalled();
    expect(clientMocks.loadSettings).not.toHaveBeenCalled();
    expect(clientMocks.create).not.toHaveBeenCalled();
  });

  it("loads applications and saves a confirmed Applied status", async () => {
    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Staff Software Engineer" })).toBeTruthy();
    fireEvent.change(document.querySelector("#status-application-one") as HTMLSelectElement, {
      target: { value: "Applied" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Submitted on the company site" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(clientMocks.update).toHaveBeenCalledWith(
        USER,
        APPLICATION.id,
        {
          status: "Applied",
          notes: "Submitted on the company site",
          nextAction: null,
          nextActionDate: null,
        },
      ),
    );
    expect(await screen.findByText("Application updated.")).toBeTruthy();
  });

  it("adds a job found outside ResumeMatch", async () => {
    clientMocks.load.mockResolvedValue([]);
    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    await screen.findByText("No applications yet");
    fireEvent.click(screen.getByRole("button", { name: "Add Application" }));
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Product Engineer" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "Remote" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add Application" }).find(
        (button) => !button.hasAttribute("disabled"),
      ) as HTMLButtonElement,
    );

    await waitFor(() => expect(clientMocks.create).toHaveBeenCalledOnce());
    expect(clientMocks.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        title: "Product Engineer",
        company: "Acme",
        location: "Remote",
        origin: "manual",
        status: "Applying",
      }),
    );
    expect(await screen.findByText("Application added.")).toBeTruthy();
  });

  it("filters by search, status, date, and archive state", async () => {
    const interviewApplication = {
      ...APPLICATION,
      id: "application-two",
      title: "Product Engineer",
      company: "Acme",
      status: "Interview" as const,
      dateAdded: "2026-08-01T18:00:00.000Z",
      appliedDate: "2026-08-02",
    };
    const archivedApplication = {
      ...APPLICATION,
      id: "application-three",
      title: "Backend Engineer",
      company: "Oldco",
      status: "Rejected" as const,
      dateAdded: "2026-07-01T18:00:00.000Z",
      appliedDate: "2026-07-02",
      archived: true,
      archivedAt: "2026-09-01T18:00:00.000Z",
      archiveReason: "inactivity" as const,
    };
    clientMocks.load.mockResolvedValue([
      APPLICATION,
      interviewApplication,
      archivedApplication,
    ]);

    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    expect(await screen.findByText("Northstar")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.queryByText("Oldco")).toBeNull();

    fireEvent.change(screen.getByLabelText("Company or job title"), {
      target: { value: "Product" },
    });
    expect(screen.queryByText("Northstar")).toBeNull();
    expect(screen.getByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Status", { selector: "#application-status-filter" }), {
      target: { value: "Applying" },
    });
    expect(screen.getByText("Northstar")).toBeTruthy();
    expect(screen.queryByText("Acme")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Date field"), {
      target: { value: "appliedDate" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-08-01" },
    });
    expect(screen.queryByText("Northstar")).toBeNull();
    expect(screen.getByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Active or archived"), {
      target: { value: "archived" },
    });
    expect(screen.getByText("Oldco")).toBeTruthy();
    expect(screen.queryByText("Northstar")).toBeNull();
  });

  it("shows status counts, excludes archived applications by default, and opens a status in the list", async () => {
    const interviewApplication = {
      ...APPLICATION,
      id: "application-two",
      title: "Product Engineer",
      company: "Acme",
      status: "Interview" as const,
    };
    const archivedApplication = {
      ...APPLICATION,
      id: "application-three",
      title: "Backend Engineer",
      company: "Oldco",
      status: "Rejected" as const,
      archived: true,
      archivedAt: "2026-09-01T18:00:00.000Z",
      archiveReason: "inactivity" as const,
    };
    clientMocks.load.mockResolvedValue([
      APPLICATION,
      interviewApplication,
      archivedApplication,
    ]);

    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    await screen.findByText("Northstar");
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    expect(screen.getByRole("heading", { name: "Application progress" })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Automatic inactivity archiving" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Applying: 1 application. Show in list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Interview: 1 application. Show in list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rejected: 0 applications" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include archived applications" }));
    expect(screen.getByRole("button", { name: "Rejected: 1 application. Show in list" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rejected: 1 application. Show in list" }));
    expect(screen.getByText("Oldco")).toBeTruthy();
    expect(screen.queryByText("Northstar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    fireEvent.click(screen.getByRole("button", { name: "Interview: 1 application. Show in list" }));
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    expect(
      (screen.getByLabelText("Status", {
        selector: "#application-status-filter",
      }) as HTMLSelectElement).value,
    ).toBe("Interview");
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.queryByText("Northstar")).toBeNull();
    expect(screen.queryByText("Oldco")).toBeNull();
  });

  it("archives, restores, and permanently deletes with confirmation", async () => {
    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    await screen.findByText("Northstar");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(clientMocks.archive).toHaveBeenCalledWith(
        USER,
        APPLICATION.id,
        true,
      ),
    );
    expect(
      await screen.findByText("Application archived. Its status was not changed."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Active or archived"), {
      target: { value: "archived" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore to Active" }));
    await waitFor(() =>
      expect(clientMocks.archive).toHaveBeenLastCalledWith(
        USER,
        APPLICATION.id,
        false,
      ),
    );

    fireEvent.change(screen.getByLabelText("Active or archived"), {
      target: { value: "active" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "Permanently delete this application?",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() =>
      expect(clientMocks.delete).toHaveBeenCalledWith(USER, APPLICATION.id),
    );
    expect(await screen.findByText("Application permanently deleted.")).toBeTruthy();
    expect(screen.queryByText("Northstar")).toBeNull();
  });

  it("updates the inactivity archive policy and reevaluates applications", async () => {
    render(
      <Applications
        identity={{ kind: "user", user: USER }}
        firebaseAvailable
        authBusy={false}
        authMessage={null}
        onBack={vi.fn()}
        onGoogleSignIn={vi.fn()}
      />,
    );

    await screen.findByText("Northstar");
    fireEvent.change(screen.getByLabelText("Inactive for"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));

    await waitFor(() =>
      expect(clientMocks.saveSettings).toHaveBeenCalledWith(USER, {
        autoArchiveDays: 60,
      }),
    );
    expect(clientMocks.load).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("Inactive applications will archive after 60 days."),
    ).toBeTruthy();
  });
});
