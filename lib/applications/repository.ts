import "server-only";

import { createHash } from "node:crypto";

import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { applicationSettingsRepository } from "./settings-repository";

import type {
  ApplicationArchiveReason,
  ApplicationUpdates,
  AutoArchiveDays,
  CreateApplicationInput,
  CreateApplicationResult,
  TrackedApplication,
} from "./types";
import {
  ApplicationValidationError,
  parseCreateApplication,
  parseTrackedApplication,
} from "./validation";

const APPLICATION_SCHEMA_VERSION = 2;
const DEFAULT_APPLICATION_LIMIT = 500;
const INACTIVITY_MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

type StoredApplication = CreateApplicationInput & {
  schemaVersion: typeof APPLICATION_SCHEMA_VERSION;
  dateAdded: Timestamp;
  lastUpdated: Timestamp;
  lastActivityAt: Timestamp;
  archived: boolean;
  archivedAt: Timestamp | null;
  archiveReason: ApplicationArchiveReason | null;
};

type FirestoreProvider = () => Firestore;
type TimestampProvider = () => Timestamp;
type AutoArchiveDaysProvider = (userId: string) => Promise<AutoArchiveDays>;

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application not found.");
    this.name = "ApplicationNotFoundError";
  }
}

function normalizedUrlForIdentity(jobUrl: string) {
  const url = new URL(jobUrl);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

export function applicationDocumentId(jobUrl: string) {
  return `url_${createHash("sha256")
    .update(normalizedUrlForIdentity(jobUrl))
    .digest("hex")}`;
}

function isoTimestamp(value: unknown, label: string) {
  if (!(value instanceof Timestamp)) {
    throw new ApplicationValidationError(`${label} is invalid.`);
  }
  return value.toDate().toISOString();
}

function optionalIsoTimestamp(value: unknown, label: string) {
  return value === null ? null : isoTimestamp(value, label);
}

function fromStoredDocument(
  id: string,
  data: DocumentData | undefined,
): TrackedApplication {
  if (!data || (data.schemaVersion !== 1 && data.schemaVersion !== 2)) {
    throw new ApplicationValidationError("Unsupported application schema.");
  }

  const isCurrentSchema = data.schemaVersion === APPLICATION_SCHEMA_VERSION;
  return parseTrackedApplication({
    id,
    ...parseCreateApplication({
      title: data.title,
      company: data.company,
      location: data.location,
      salary: data.salary,
      jobUrl: data.jobUrl,
      source: data.source,
      sourceJobId: data.sourceJobId,
      origin: data.origin,
      status: data.status,
      appliedDate: data.appliedDate,
      notes: data.notes,
      nextAction: data.nextAction,
      nextActionDate: data.nextActionDate,
    }),
    dateAdded: isoTimestamp(data.dateAdded, "Date added"),
    lastUpdated: isoTimestamp(data.lastUpdated, "Last updated"),
    lastActivityAt: isCurrentSchema
      ? isoTimestamp(data.lastActivityAt, "Last activity")
      : isoTimestamp(data.lastUpdated, "Last activity"),
    archived: isCurrentSchema ? data.archived : false,
    archivedAt: isCurrentSchema
      ? optionalIsoTimestamp(data.archivedAt, "Archived at")
      : null,
    archiveReason: isCurrentSchema ? data.archiveReason : null,
  });
}

function calendarDate(timestamp: Timestamp) {
  return timestamp.toDate().toISOString().slice(0, 10);
}

function timestampFromIso(value: string) {
  return Timestamp.fromDate(new Date(value));
}

function migrationFields(application: TrackedApplication) {
  return {
    schemaVersion: APPLICATION_SCHEMA_VERSION,
    lastActivityAt: timestampFromIso(application.lastActivityAt),
    archived: application.archived,
    archivedAt: application.archivedAt
      ? timestampFromIso(application.archivedAt)
      : null,
    archiveReason: application.archiveReason,
  };
}

function isAutoArchiveProtected(application: TrackedApplication) {
  return application.status === "Interview" || application.status === "Offer";
}

export class FirestoreApplicationsRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: TimestampProvider = () => Timestamp.now(),
    private readonly getAutoArchiveDays: AutoArchiveDaysProvider = async (
      userId,
    ) => (await applicationSettingsRepository.get(userId)).autoArchiveDays,
  ) {}

  async list(
    userId: string,
    options: { limit?: number | null } = {},
  ): Promise<TrackedApplication[]> {
    const limit = options.limit === undefined
      ? DEFAULT_APPLICATION_LIMIT
      : options.limit;
    const firestore = this.getFirestore();
    const ordered = this.collection(userId, firestore).orderBy(
      "lastUpdated",
      "desc",
    );
    const query = limit === null ? ordered : ordered.limit(limit);
    const autoArchiveDays = await this.getAutoArchiveDays(userId);
    if (autoArchiveDays === null) {
      const snapshot = await query.get();
      return snapshot.docs.map((document) =>
        fromStoredDocument(document.id, document.data()),
      );
    }

    const timestamp = this.now();
    const inactivityCutoff =
      timestamp.toMillis() - autoArchiveDays * INACTIVITY_MILLISECONDS_PER_DAY;
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(query);
      const applications = snapshot.docs.map((document) => {
        const data = document.data();
        const application = fromStoredDocument(document.id, data);
        const lastActivityAt = timestampFromIso(application.lastActivityAt);
        if (
          application.archived ||
          isAutoArchiveProtected(application) ||
          lastActivityAt.toMillis() > inactivityCutoff
        ) {
          return application;
        }

        const archivedData = {
          ...data,
          schemaVersion: APPLICATION_SCHEMA_VERSION,
          lastActivityAt,
          archived: true,
          archivedAt: timestamp,
          archiveReason: "inactivity" as const,
          lastUpdated: timestamp,
        };
        transaction.update(document.ref, {
          schemaVersion: APPLICATION_SCHEMA_VERSION,
          lastActivityAt,
          archived: true,
          archivedAt: timestamp,
          archiveReason: "inactivity",
          lastUpdated: timestamp,
        });
        return fromStoredDocument(document.id, archivedData);
      });

      return applications.sort((left, right) =>
        right.lastUpdated.localeCompare(left.lastUpdated),
      );
    });
  }

  async create(
    userId: string,
    input: CreateApplicationInput,
  ): Promise<CreateApplicationResult> {
    const normalized = parseCreateApplication(input);
    const firestore = this.getFirestore();
    const collection = this.collection(userId, firestore);
    const document = normalized.jobUrl
      ? collection.doc(applicationDocumentId(normalized.jobUrl))
      : collection.doc();

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      if (snapshot.exists) {
        const timestamp = this.now();
        const application = fromStoredDocument(snapshot.id, snapshot.data());
        const activeApplication = {
          ...application,
          lastActivityAt: timestamp.toDate().toISOString(),
          lastUpdated: timestamp.toDate().toISOString(),
        };
        transaction.update(document, {
          ...migrationFields(application),
          lastActivityAt: timestamp,
          lastUpdated: timestamp,
        });
        return {
          application: activeApplication,
          created: false,
        };
      }

      const timestamp = this.now();
      const stored: StoredApplication = {
        schemaVersion: APPLICATION_SCHEMA_VERSION,
        ...normalized,
        appliedDate:
          normalized.appliedDate ??
          (normalized.status === "Applied" ? calendarDate(timestamp) : null),
        dateAdded: timestamp,
        lastUpdated: timestamp,
        lastActivityAt: timestamp,
        archived: false,
        archivedAt: null,
        archiveReason: null,
      };
      transaction.create(document, stored);

      return {
        application: fromStoredDocument(document.id, stored),
        created: true,
      };
    });
  }

  async update(
    userId: string,
    applicationId: string,
    updates: ApplicationUpdates,
  ): Promise<TrackedApplication> {
    const firestore = this.getFirestore();
    const document = this.collection(userId, firestore).doc(applicationId);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      if (!snapshot.exists) throw new ApplicationNotFoundError();

      const current = fromStoredDocument(snapshot.id, snapshot.data());
      const timestamp = this.now();
      const appliedDate =
        updates.appliedDate !== undefined
          ? updates.appliedDate
          : updates.status === "Applied" && current.appliedDate === null
            ? calendarDate(timestamp)
            : current.appliedDate;
      const next: TrackedApplication = {
        ...current,
        ...updates,
        appliedDate,
        lastUpdated: timestamp.toDate().toISOString(),
        lastActivityAt: timestamp.toDate().toISOString(),
      };

      transaction.update(document, {
        ...migrationFields(current),
        ...updates,
        appliedDate,
        lastUpdated: timestamp,
        lastActivityAt: timestamp,
      });
      return next;
    });
  }

  async setArchived(
    userId: string,
    applicationId: string,
    archived: boolean,
  ): Promise<TrackedApplication> {
    const firestore = this.getFirestore();
    const document = this.collection(userId, firestore).doc(applicationId);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      if (!snapshot.exists) throw new ApplicationNotFoundError();

      const current = fromStoredDocument(snapshot.id, snapshot.data());
      if (current.archived === archived) return current;

      const timestamp = this.now();
      const next: TrackedApplication = {
        ...current,
        archived,
        archivedAt: archived ? timestamp.toDate().toISOString() : null,
        archiveReason: archived ? "manual" : null,
        lastUpdated: timestamp.toDate().toISOString(),
        lastActivityAt: archived
          ? current.lastActivityAt
          : timestamp.toDate().toISOString(),
      };
      transaction.update(document, {
        ...migrationFields(current),
        archived: next.archived,
        archivedAt: archived ? timestamp : null,
        archiveReason: next.archiveReason,
        lastUpdated: timestamp,
        lastActivityAt: archived
          ? timestampFromIso(current.lastActivityAt)
          : timestamp,
      });
      return next;
    });
  }

  async delete(userId: string, applicationId: string): Promise<void> {
    const firestore = this.getFirestore();
    const document = this.collection(userId, firestore).doc(applicationId);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      if (!snapshot.exists) throw new ApplicationNotFoundError();
      transaction.delete(document);
    });
  }

  private collection(userId: string, firestore = this.getFirestore()) {
    return firestore.collection("users").doc(userId).collection("applications");
  }
}

export const applicationsRepository = new FirestoreApplicationsRepository();
