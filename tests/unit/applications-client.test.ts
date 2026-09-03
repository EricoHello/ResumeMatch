import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackResumeMatchJob } from "@/lib/applications/client";

describe("trackResumeMatchJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a signed-in result to the tracker as Applying", async () => {
    const user = {
      getIdToken: vi.fn().mockResolvedValue("firebase-token"),
    } as unknown as User;
    const job = {
      id: "job-123",
      title: "Staff Software Engineer",
      company: "Northstar",
      location: "Seattle, WA",
      salary: "$160,000 / year",
      applyUrl: "https://jobs.example.test/one",
      postedAt: "2 days ago",
      employmentType: "FULLTIME",
      isRemote: false,
      matchedSkills: ["TypeScript"],
    };
    const tracked = {
      id: "url_hash",
      title: job.title,
      company: job.company,
      location: job.location,
      salary: job.salary,
      jobUrl: job.applyUrl,
      source: "JSearch",
      sourceJobId: job.id,
      origin: "resumematch",
      status: "Applying",
      dateAdded: "2026-09-02T18:00:00.000Z",
      appliedDate: null,
      lastUpdated: "2026-09-02T18:00:00.000Z",
      lastActivityAt: "2026-09-02T18:00:00.000Z",
      archived: false,
      archivedAt: null,
      archiveReason: null,
      notes: "",
      nextAction: null,
      nextActionDate: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { application: tracked, created: true } }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(trackResumeMatchJob(user, job)).resolves.toEqual({
      application: tracked,
      created: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      title: job.title,
      company: job.company,
      jobUrl: job.applyUrl,
      source: "JSearch",
      sourceJobId: job.id,
      origin: "resumematch",
      status: "Applying",
      appliedDate: null,
    });
  });
});
