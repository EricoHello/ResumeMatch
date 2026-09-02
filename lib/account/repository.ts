import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { preferencesRepository } from "@/lib/preferences/repository";
import { resumePrivacyRepository } from "@/lib/privacy/repository";
import { savedResumeRepository } from "@/lib/resume/saved-repository";

import type { ResumeMatchDataExport } from "./types";

type FirestoreProvider = () => Firestore;
type ExportClock = () => Date;

export class FirestoreAccountDataRepository {
  constructor(
    private readonly getFirestore: FirestoreProvider =
      getFirebaseAdminFirestore,
    private readonly now: ExportClock = () => new Date(),
  ) {}

  async export(userId: string): Promise<ResumeMatchDataExport> {
    const [savedPreferences, savedResume, privacySettings] = await Promise.all([
      preferencesRepository.get(userId),
      savedResumeRepository.get(userId),
      resumePrivacyRepository.get(userId),
    ]);

    return {
      schemaVersion: 2,
      generatedAt: this.now().toISOString(),
      data: {
        savedPreferences,
        extractedResumeText: savedResume?.resumeText ?? null,
        aiCandidateProfile: savedResume?.profile ?? null,
        privacySettings,
      },
    };
  }

  async delete(userId: string): Promise<void> {
    const firestore = this.getFirestore();
    const userDocument = firestore.collection("users").doc(userId);
    await firestore.recursiveDelete(userDocument);
  }
}

export const accountDataRepository = new FirestoreAccountDataRepository();
