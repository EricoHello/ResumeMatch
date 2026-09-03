"use client";

import type { User } from "firebase/auth";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PreferenceIdentity } from "@/components/job-preferences";
import {
  createApplication,
  deleteApplication,
  loadApplicationSettings,
  loadApplications,
  saveApplicationSettings,
  setApplicationArchived,
  updateApplication,
} from "@/lib/applications/client";
import {
  APPLICATION_STATUSES,
  AUTO_ARCHIVE_DAY_OPTIONS,
  type ApplicationSettings,
  type ApplicationStatus,
  type ApplicationUpdates,
  type CreateApplicationInput,
  type TrackedApplication,
} from "@/lib/applications/types";

type ApplicationsProps = {
  identity: PreferenceIdentity;
  firebaseAvailable: boolean;
  authBusy: boolean;
  authMessage: string | null;
  onBack: () => void;
  onGoogleSignIn: () => void;
};

type ApplicationsState =
  | { status: "loading" }
  | {
      status: "ready";
      applications: TrackedApplication[];
      settings: ApplicationSettings;
    }
  | { status: "error"; message: string };

type ArchiveFilter = "active" | "archived" | "all";
type DateFilterField = "dateAdded" | "appliedDate";
type ApplicationsView = "list" | "graph";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : DATE_FORMATTER.format(date);
}

function filterDate(application: TrackedApplication, field: DateFilterField) {
  const value = application[field];
  return value ? value.slice(0, 10) : null;
}

function optionalFormValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredFormValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function statusFromForm(form: FormData) {
  return requiredFormValue(form, "status") as ApplicationStatus;
}

function ApplicationsGraph({
  applications,
  includeArchived,
  onIncludeArchivedChange,
  onStatusSelect,
}: {
  applications: TrackedApplication[];
  includeArchived: boolean;
  onIncludeArchivedChange: (includeArchived: boolean) => void;
  onStatusSelect: (status: ApplicationStatus) => void;
}) {
  const includedApplications = useMemo(
    () =>
      applications.filter(
        (application) => includeArchived || !application.archived,
      ),
    [applications, includeArchived],
  );
  const statusCounts = useMemo(
    () =>
      APPLICATION_STATUSES.map((status) => ({
        status,
        count: includedApplications.filter(
          (application) => application.status === status,
        ).length,
      })),
    [includedApplications],
  );
  const largestCount = Math.max(1, ...statusCounts.map(({ count }) => count));
  const total = includedApplications.length;

  return (
    <section
      className="account-card application-graph-card"
      aria-labelledby="application-progress-heading"
    >
      <div className="application-graph-heading">
        <div>
          <p className="step-label">Status overview</p>
          <h2 id="application-progress-heading">Application progress</h2>
          <p>
            See how your applications are distributed across each stage of the
            process.
          </p>
        </div>
        <label className="application-graph-archive-toggle">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) =>
              onIncludeArchivedChange(event.target.checked)
            }
          />
          <span>Include archived applications</span>
        </label>
      </div>

      <div className="application-graph-total" aria-live="polite">
        <strong>{total}</strong>
        <span>
          {includeArchived ? "active and archived" : "active"}{" "}
          {total === 1 ? "application" : "applications"}
        </span>
      </div>

      <div
        className="application-status-chart"
        aria-label="Applications by status"
      >
        {statusCounts.map(({ status, count }) => (
          <button
            className={`application-status-bar application-status-bar--${status.toLowerCase()}`}
            type="button"
            key={status}
            disabled={count === 0}
            aria-label={`${status}: ${count} ${count === 1 ? "application" : "applications"}${
              count > 0 ? ". Show in list" : ""
            }`}
            onClick={() => onStatusSelect(status)}
          >
            <span className="application-status-bar-label">{status}</span>
            <span className="application-status-bar-track" aria-hidden="true">
              <span
                className="application-status-bar-fill"
                style={{ width: `${(count / largestCount) * 100}%` }}
              />
            </span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>

      <p className="application-graph-hint">
        Select a status to view those applications in the list.
      </p>
    </section>
  );
}

function ApplicationEditor({
  application,
  onSave,
  onArchiveChange,
  onDelete,
}: {
  application: TrackedApplication;
  onSave: (
    applicationId: string,
    updates: ApplicationUpdates,
  ) => Promise<TrackedApplication>;
  onArchiveChange: (
    applicationId: string,
    archived: boolean,
  ) => Promise<TrackedApplication>;
  onDelete: (applicationId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const status = statusFromForm(form);
    const appliedDate = optionalFormValue(form, "appliedDate");
    const updates: ApplicationUpdates = {
      status,
      notes: requiredFormValue(form, "notes"),
      nextAction: optionalFormValue(form, "nextAction"),
      nextActionDate: optionalFormValue(form, "nextActionDate"),
    };
    if (
      appliedDate !== null ||
      application.appliedDate !== null ||
      status !== "Applied"
    ) {
      updates.appliedDate = appliedDate;
    }
    setBusy(true);
    setMessage(null);
    try {
      const updated = await onSave(application.id, updates);
      const appliedDateInput = formElement.elements.namedItem("appliedDate");
      if (appliedDateInput instanceof HTMLInputElement) {
        appliedDateInput.value = updated.appliedDate ?? "";
      }
      setMessage({ kind: "success", text: "Application updated." });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn't update this application.",
      });
    } finally {
      setBusy(false);
    }
  };

  const changeArchivedState = async () => {
    setArchiveBusy(true);
    setMessage(null);
    try {
      await onArchiveChange(application.id, !application.archived);
      setMessage({
        kind: "success",
        text: application.archived
          ? "Application restored to Active."
          : "Application archived without changing its status.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : `We couldn't ${application.archived ? "restore" : "archive"} this application.`,
      });
    } finally {
      setArchiveBusy(false);
    }
  };

  const permanentlyDelete = async () => {
    setDeleteBusy(true);
    setMessage(null);
    try {
      await onDelete(application.id);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn't delete this application.",
      });
      setDeleteBusy(false);
    }
  };

  return (
    <li
      className={`application-card${application.archived ? " application-card--archived" : ""}`}
    >
      <div className="application-card-heading">
        <div>
          <p className="job-company">{application.company}</p>
          <h2>{application.title}</h2>
          <p className="application-location">{application.location}</p>
        </div>
        <div className="application-badges">
          <span
            className={`application-status application-status--${application.status.toLowerCase()}`}
          >
            {application.status}
          </span>
          {application.archived && (
            <span className="application-archive-badge">
              {application.archiveReason === "inactivity"
                ? "Auto-archived"
                : "Archived"}
            </span>
          )}
        </div>
      </div>

      <dl className="application-facts">
        <div>
          <dt>Salary</dt>
          <dd>{application.salary ?? "Not listed"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{application.source}</dd>
        </div>
        <div>
          <dt>Date added</dt>
          <dd>{displayDate(application.dateAdded)}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{displayDate(application.lastActivityAt)}</dd>
        </div>
      </dl>

      {application.archivedAt && (
        <p className="application-archived-note">
          Archived {displayDate(application.archivedAt)}. Status remains {application.status}.
        </p>
      )}

      {application.jobUrl && (
        <a
          className="application-job-link"
          href={application.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open job posting <span aria-hidden="true">↗</span>
        </a>
      )}

      <form className="application-edit-form" onSubmit={(event) => void submit(event)}>
        <div className="application-form-grid">
          <div className="field">
            <label htmlFor={`status-${application.id}`}>Status</label>
            <select
              id={`status-${application.id}`}
              name="status"
              defaultValue={application.status}
            >
              {APPLICATION_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`applied-date-${application.id}`}>Applied date</label>
            <input
              id={`applied-date-${application.id}`}
              name="appliedDate"
              type="date"
              defaultValue={application.appliedDate ?? ""}
            />
          </div>
          <div className="field application-form-wide">
            <label htmlFor={`notes-${application.id}`}>Notes</label>
            <textarea
              id={`notes-${application.id}`}
              name="notes"
              rows={3}
              maxLength={5_000}
              defaultValue={application.notes}
              placeholder="Contacts, interview details, or anything worth remembering"
            />
          </div>
          <div className="field">
            <label htmlFor={`next-action-${application.id}`}>Next action</label>
            <input
              id={`next-action-${application.id}`}
              name="nextAction"
              maxLength={500}
              defaultValue={application.nextAction ?? ""}
              placeholder="Follow up with recruiter"
            />
          </div>
          <div className="field">
            <label htmlFor={`next-date-${application.id}`}>Next action date</label>
            <input
              id={`next-date-${application.id}`}
              name="nextActionDate"
              type="date"
              defaultValue={application.nextActionDate ?? ""}
            />
          </div>
        </div>
        <div className="application-edit-actions">
          <button className="secondary-button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={archiveBusy || deleteBusy}
            onClick={() => void changeArchivedState()}
          >
            {archiveBusy
              ? application.archived
                ? "Restoring…"
                : "Archiving…"
              : application.archived
                ? "Restore to Active"
                : "Archive"}
          </button>
          <button
            className="application-delete-button"
            type="button"
            disabled={deleteBusy}
            onClick={() => setDeleteConfirmationOpen(true)}
          >
            Delete
          </button>
          {message && (
            <p
              className={`application-form-message application-form-message--${message.kind}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          )}
        </div>
        {deleteConfirmationOpen && (
          <div
            className="application-delete-confirmation"
            role="alertdialog"
            aria-labelledby={`delete-application-${application.id}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !deleteBusy) {
                setDeleteConfirmationOpen(false);
              }
            }}
          >
            <div>
              <strong id={`delete-application-${application.id}`}>
                Permanently delete this application?
              </strong>
              <p>
                {application.title} at {application.company} will be removed. This
                cannot be undone.
              </p>
            </div>
            <div className="application-delete-confirmation-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteConfirmationOpen(false)}
              >
                Cancel
              </button>
              <button
                className="danger-button danger-button--solid"
                type="button"
                disabled={deleteBusy}
                autoFocus
                onClick={() => void permanentlyDelete()}
              >
                {deleteBusy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </form>
    </li>
  );
}

function AddApplicationForm({
  user,
  onAdded,
  onCancel,
}: {
  user: User;
  onAdded: (result: { application: TrackedApplication; created: boolean }) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input: CreateApplicationInput = {
      title: requiredFormValue(form, "title"),
      company: requiredFormValue(form, "company"),
      location: requiredFormValue(form, "location"),
      salary: optionalFormValue(form, "salary"),
      jobUrl: optionalFormValue(form, "jobUrl"),
      source: requiredFormValue(form, "source"),
      sourceJobId: null,
      origin: "manual",
      status: statusFromForm(form),
      appliedDate: optionalFormValue(form, "appliedDate"),
      notes: requiredFormValue(form, "notes"),
      nextAction: optionalFormValue(form, "nextAction"),
      nextActionDate: optionalFormValue(form, "nextActionDate"),
    };

    setBusy(true);
    setError(null);
    try {
      const result = await createApplication(user, input);
      formElement.reset();
      onAdded(result);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "We couldn't add this application.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-card add-application-form" onSubmit={(event) => void submit(event)}>
      <div className="application-section-heading">
        <div>
          <p className="step-label">Manual entry</p>
          <h2>Add Application</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="application-form-grid">
        <div className="field">
          <label htmlFor="application-title">Job title</label>
          <input id="application-title" name="title" maxLength={240} required />
        </div>
        <div className="field">
          <label htmlFor="application-company">Company</label>
          <input id="application-company" name="company" maxLength={240} required />
        </div>
        <div className="field">
          <label htmlFor="application-location">Location</label>
          <input id="application-location" name="location" maxLength={300} required />
        </div>
        <div className="field">
          <label htmlFor="application-salary">Salary (optional)</label>
          <input id="application-salary" name="salary" maxLength={180} placeholder="$120,000–$145,000 / year" />
        </div>
        <div className="field">
          <label htmlFor="application-url">Job URL (optional)</label>
          <input id="application-url" name="jobUrl" type="url" maxLength={2_000} placeholder="https://…" />
        </div>
        <div className="field">
          <label htmlFor="application-source">Source</label>
          <input id="application-source" name="source" maxLength={120} defaultValue="Company website" required />
        </div>
        <div className="field">
          <label htmlFor="application-status">Status</label>
          <select id="application-status" name="status" defaultValue="Applying">
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="application-applied-date">Applied date</label>
          <input id="application-applied-date" name="appliedDate" type="date" />
        </div>
        <div className="field application-form-wide">
          <label htmlFor="application-notes">Notes</label>
          <textarea id="application-notes" name="notes" rows={3} maxLength={5_000} />
        </div>
        <div className="field">
          <label htmlFor="application-next-action">Next action (optional)</label>
          <input id="application-next-action" name="nextAction" maxLength={500} />
        </div>
        <div className="field">
          <label htmlFor="application-next-date">Next action date</label>
          <input id="application-next-date" name="nextActionDate" type="date" />
        </div>
      </div>
      <div className="application-add-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add Application"}
        </button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </form>
  );
}

export function Applications({
  identity,
  firebaseAvailable,
  authBusy,
  authMessage,
  onBack,
  onGoogleSignIn,
}: ApplicationsProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const signedInUser = identity.kind === "user" ? identity.user : null;
  const [state, setState] = useState<ApplicationsState>(
    signedInUser
      ? { status: "loading" }
      : {
          status: "ready",
          applications: [],
          settings: { autoArchiveDays: 30 },
        },
  );
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<ApplicationsView>("list");
  const [includeArchivedInGraph, setIncludeArchivedInGraph] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ApplicationStatus>(
    "all",
  );
  const [archiveFilter, setArchiveFilter] =
    useState<ArchiveFilter>("active");
  const [searchFilter, setSearchFilter] = useState("");
  const [dateFilterField, setDateFilterField] =
    useState<DateFilterField>("dateAdded");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!signedInUser) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading" });
    try {
      const [applications, settings] = await Promise.all([
        loadApplications(signedInUser, controller.signal),
        loadApplicationSettings(signedInUser, controller.signal),
      ]);
      if (!controller.signal.aborted) {
        setState({ status: "ready", applications, settings });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn't load your applications.",
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [signedInUser]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      if (signedInUser) void load();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load, signedInUser]);

  const replaceApplication = useCallback((updated: TrackedApplication) => {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            applications: current.applications
              .map((application) =>
                application.id === updated.id ? updated : application,
              )
              .sort((left, right) =>
                right.lastUpdated.localeCompare(left.lastUpdated),
              ),
          }
        : current,
    );
  }, []);

  const saveUpdates = useCallback(
    async (applicationId: string, updates: ApplicationUpdates) => {
      if (!signedInUser) throw new Error("Sign in to update applications.");
      const updated = await updateApplication(signedInUser, applicationId, updates);
      replaceApplication(updated);
      return updated;
    },
    [replaceApplication, signedInUser],
  );

  const changeArchiveState = useCallback(
    async (applicationId: string, archived: boolean) => {
      if (!signedInUser) throw new Error("Sign in to manage applications.");
      const updated = await setApplicationArchived(
        signedInUser,
        applicationId,
        archived,
      );
      replaceApplication(updated);
      setNotice(
        archived
          ? "Application archived. Its status was not changed."
          : "Application restored to Active.",
      );
      return updated;
    },
    [replaceApplication, signedInUser],
  );

  const permanentlyDeleteApplication = useCallback(
    async (applicationId: string) => {
      if (!signedInUser) throw new Error("Sign in to delete applications.");
      await deleteApplication(signedInUser, applicationId);
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              applications: current.applications.filter(
                (application) => application.id !== applicationId,
              ),
            }
          : current,
      );
      setNotice("Application permanently deleted.");
    },
    [signedInUser],
  );

  const saveAutoArchiveSetting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signedInUser || state.status !== "ready") return;
    const form = new FormData(event.currentTarget);
    const rawDays = requiredFormValue(form, "autoArchiveDays");
    const autoArchiveDays = rawDays === "never" ? null : Number(rawDays);
    const settings = {
      autoArchiveDays,
    } as ApplicationSettings;

    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const saved = await saveApplicationSettings(signedInUser, settings);
      const applications = await loadApplications(signedInUser);
      setState({ status: "ready", applications, settings: saved });
      setSettingsMessage({
        kind: "success",
        text:
          saved.autoArchiveDays === null
            ? "Automatic archiving is off."
            : `Inactive applications will archive after ${saved.autoArchiveDays} days.`,
      });
    } catch (error) {
      setSettingsMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn't save application settings.",
      });
    } finally {
      setSettingsBusy(false);
    }
  };

  const filteredApplications = useMemo(() => {
    if (state.status !== "ready") return [];
    const query = searchFilter.trim().toLocaleLowerCase();
    return state.applications.filter((application) => {
      if (archiveFilter === "active" && application.archived) return false;
      if (archiveFilter === "archived" && !application.archived) return false;
      if (statusFilter !== "all" && application.status !== statusFilter) {
        return false;
      }
      if (
        query &&
        !`${application.company} ${application.title}`
          .toLocaleLowerCase()
          .includes(query)
      ) {
        return false;
      }
      const applicationDate = filterDate(application, dateFilterField);
      if (dateFrom && (!applicationDate || applicationDate < dateFrom)) {
        return false;
      }
      if (dateTo && (!applicationDate || applicationDate > dateTo)) {
        return false;
      }
      return true;
    });
  }, [
    archiveFilter,
    dateFilterField,
    dateFrom,
    dateTo,
    searchFilter,
    state,
    statusFilter,
  ]);

  const graphApplicationCount =
    state.status === "ready"
      ? state.applications.filter(
          (application) => includeArchivedInGraph || !application.archived,
        ).length
      : 0;
  const toolbarCount =
    state.status === "ready"
      ? view === "graph"
        ? graphApplicationCount
        : filteredApplications.length
      : "—";
  const toolbarDescription =
    state.status !== "ready"
      ? "loading applications"
      : view === "graph"
        ? `${includeArchivedInGraph ? "active and archived" : "active"} ${
            graphApplicationCount === 1 ? "application" : "applications"
          } visualized`
        : `of ${state.applications.length} tracked ${
            state.applications.length === 1 ? "application" : "applications"
          } shown`;

  const clearFilters = () => {
    setStatusFilter("all");
    setArchiveFilter("active");
    setSearchFilter("");
    setDateFilterField("dateAdded");
    setDateFrom("");
    setDateTo("");
  };

  const showStatusInList = (status: ApplicationStatus) => {
    setStatusFilter(status);
    setArchiveFilter(includeArchivedInGraph ? "all" : "active");
    setSearchFilter("");
    setDateFilterField("dateAdded");
    setDateFrom("");
    setDateTo("");
    setView("list");
  };

  const handleAdded = (result: {
    application: TrackedApplication;
    created: boolean;
  }) => {
    setState((current) => {
      if (current.status !== "ready") return current;
      const withoutExisting = current.applications.filter(
        (application) => application.id !== result.application.id,
      );
      return {
        ...current,
        applications: [result.application, ...withoutExisting],
      };
    });
    setAddOpen(false);
    setNotice(
      result.created
        ? "Application added."
        : "That job URL is already in your tracker; the existing application was kept.",
    );
  };

  return (
    <section className="applications-page account-page" aria-labelledby="applications-heading">
      <button className="account-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        Back to resume matching
      </button>
      <header className="account-page-heading applications-page-heading">
        <p className="eyebrow">Your job search</p>
        <h1 id="applications-heading" ref={headingRef} tabIndex={-1}>Applications</h1>
        <p>
          Keep every opportunity, follow-up, and outcome in one place. Opening a
          ResumeMatch job starts it at Applying until you confirm submission.
        </p>
      </header>

      {!signedInUser ? (
        <section className="account-card applications-sign-in-card">
          <div>
            <p className="step-label">Account required</p>
            <h2>Sign in to track applications</h2>
            <p>
              Guest application data is never saved. Sign in with Google to keep a
              private tracker in your ResumeMatch account.
            </p>
          </div>
          <button
            className="google-button"
            type="button"
            disabled={authBusy || !firebaseAvailable}
            onClick={onGoogleSignIn}
          >
            {authBusy ? "Opening Google…" : "Sign in with Google"}
          </button>
          {!firebaseAvailable && (
            <p className="configuration-note applications-configuration-note">
              Google Sign-In isn’t configured in this environment.
            </p>
          )}
          {authMessage && <p className="form-error" role="alert">{authMessage}</p>}
        </section>
      ) : (
        <>
          <div className="applications-toolbar">
            <div className="applications-toolbar-summary">
              <strong>{toolbarCount}</strong>
              <span>{toolbarDescription}</span>
            </div>
            <div className="applications-toolbar-actions">
              <div
                className="application-view-switch"
                role="group"
                aria-label="Applications view"
              >
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  List
                </button>
                <button
                  type="button"
                  aria-pressed={view === "graph"}
                  onClick={() => setView("graph")}
                >
                  Graph
                </button>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={addOpen}
                onClick={() => {
                  setAddOpen(true);
                  setNotice(null);
                }}
              >
                Add Application
              </button>
            </div>
          </div>

          {addOpen && (
            <AddApplicationForm
              user={signedInUser}
              onAdded={handleAdded}
              onCancel={() => setAddOpen(false)}
            />
          )}

          {notice && <p className="applications-notice" role="status">{notice}</p>}

          {view === "list" &&
            state.status === "ready" &&
            state.applications.length > 0 && (
            <section
              className="account-card applications-filter-card"
              aria-labelledby="application-filters-heading"
            >
              <div className="application-section-heading">
                <div>
                  <p className="step-label">Find applications</p>
                  <h2 id="application-filters-heading">Filters</h2>
                </div>
                <button className="text-button" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
              <div className="application-filters-grid">
                <div className="field application-filter-search">
                  <label htmlFor="application-search">Company or job title</label>
                  <input
                    id="application-search"
                    type="search"
                    value={searchFilter}
                    onChange={(event) => setSearchFilter(event.target.value)}
                    placeholder="Search applications"
                  />
                </div>
                <div className="field">
                  <label htmlFor="application-status-filter">Status</label>
                  <select
                    id="application-status-filter"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "all" | ApplicationStatus)
                    }
                  >
                    <option value="all">All statuses</option>
                    {APPLICATION_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="application-archive-filter">Active or archived</label>
                  <select
                    id="application-archive-filter"
                    value={archiveFilter}
                    onChange={(event) =>
                      setArchiveFilter(event.target.value as ArchiveFilter)
                    }
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="all">Active and archived</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="application-date-filter">Date field</label>
                  <select
                    id="application-date-filter"
                    value={dateFilterField}
                    onChange={(event) =>
                      setDateFilterField(event.target.value as DateFilterField)
                    }
                  >
                    <option value="dateAdded">Date added</option>
                    <option value="appliedDate">Date applied</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="application-date-from">From</label>
                  <input
                    id="application-date-from"
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="application-date-to">To</label>
                  <input
                    id="application-date-to"
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                </div>
              </div>
            </section>
          )}

          {view === "graph" && state.status === "ready" && (
            <ApplicationsGraph
              applications={state.applications}
              includeArchived={includeArchivedInGraph}
              onIncludeArchivedChange={setIncludeArchivedInGraph}
              onStatusSelect={showStatusInList}
            />
          )}

          {view === "list" && state.status === "ready" && (
            <form
              className="account-card application-settings-card"
              onSubmit={(event) => void saveAutoArchiveSetting(event)}
            >
              <div>
                <p className="step-label">Application settings</p>
                <h2>Automatic inactivity archiving</h2>
                <p>
                  Archive applications with no meaningful updates after this many
                  days. Interview and Offer applications are never auto-archived.
                  Archiving keeps the current status and all application data.
                </p>
              </div>
              <div className="application-settings-control field">
                <label htmlFor="auto-archive-days">Inactive for</label>
                <select
                  id="auto-archive-days"
                  name="autoArchiveDays"
                  defaultValue={state.settings.autoArchiveDays ?? "never"}
                  key={state.settings.autoArchiveDays ?? "never"}
                  disabled={settingsBusy}
                >
                  {AUTO_ARCHIVE_DAY_OPTIONS.map((days) => (
                    <option key={days} value={days}>{days} days</option>
                  ))}
                  <option value="never">Never</option>
                </select>
                <button className="secondary-button" type="submit" disabled={settingsBusy}>
                  {settingsBusy ? "Saving…" : "Save setting"}
                </button>
              </div>
              {settingsMessage && (
                <p
                  className={`application-settings-message application-settings-message--${settingsMessage.kind}`}
                  role={settingsMessage.kind === "error" ? "alert" : "status"}
                >
                  {settingsMessage.text}
                </p>
              )}
            </form>
          )}

          {state.status === "loading" && (
            <section className="account-card applications-loading" aria-label="Loading applications">
              <span className="spinner" aria-hidden="true" />
              <p role="status">Loading your applications…</p>
            </section>
          )}

          {state.status === "error" && (
            <div className="notice notice--error applications-load-error" role="alert">
              <span className="notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>Couldn’t load applications</strong>
                <p>{state.message}</p>
                <div className="notice-actions">
                  <button type="button" onClick={() => void load()}>Try again</button>
                </div>
              </div>
            </div>
          )}

          {view === "list" && state.status === "ready" && state.applications.length === 0 && (
            <section className="account-card applications-empty">
              <span aria-hidden="true">↗</span>
              <h2>No applications yet</h2>
              <p>
                Use Add Application, or open a job from your ResumeMatch results to
                start tracking it automatically.
              </p>
            </section>
          )}

          {view === "list" && state.status === "ready" &&
            state.applications.length > 0 &&
            filteredApplications.length === 0 && (
              <section className="account-card applications-empty applications-filter-empty">
                <span aria-hidden="true">⌕</span>
                <h2>No applications match these filters</h2>
                <p>Try a different status, date range, archive view, or search.</p>
                <button className="secondary-button" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </section>
            )}

          {view === "list" && state.status === "ready" && filteredApplications.length > 0 && (
            <ol className="applications-list" aria-label="Tracked applications">
              {filteredApplications.map((application) => (
                <ApplicationEditor
                  key={application.id}
                  application={application}
                  onSave={saveUpdates}
                  onArchiveChange={changeArchiveState}
                  onDelete={permanentlyDeleteApplication}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
