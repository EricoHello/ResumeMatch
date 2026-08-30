import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ResumeProfile } from "@/lib/analysis/types";
import {
  JSearchClient,
  JSearchConfigurationError,
  parseJSearchResponse,
} from "@/lib/jobs/jsearch";

const PROFILE: ResumeProfile = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Kubernetes"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["distributed systems"],
  preferences: { targetLocation: "Seattle, WA", minimumSalary: 145_000 },
};

function providerJob(id: string) {
  return {
    job_id: id,
    job_title: id === "1" ? "Staff Software Engineer" : "Platform Engineer",
    employer_name: `Employer ${id}`,
    job_apply_link: `https://jobs.example.test/${id}`,
    job_description: "TypeScript Kubernetes distributed systems",
    job_location: "Seattle, WA",
    job_salary: null,
    job_min_salary: id === "1" ? 160000 : null,
    job_max_salary: id === "1" ? 190000 : null,
    job_salary_period: "year",
    job_salary_currency: "USD",
    job_posted_at: "2 days ago",
    job_posted_at_timestamp: Date.now() / 1000,
    job_employment_type: "FULLTIME",
    job_is_remote: false,
  };
}

describe("JSearchClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { jobs: [providerJob("1"), providerJob("2")] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  it("uses one combined JSearch request and ranks locally", async () => {
    const client = new JSearchClient("server-secret", fetchMock as typeof fetch);
    const jobs = await client.search(PROFILE, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(input.origin + input.pathname).toBe(
      "https://api.openwebninja.com/jsearch/search-v2",
    );
    expect(input.searchParams.get("query")).toContain("Staff Software Engineer");
    expect(input.searchParams.get("query")).toContain("Seattle, WA");
    expect(input.searchParams.get("cursor")).toBeNull();
    expect(input.searchParams.get("num_pages")).toBeNull();
    expect(input.searchParams.get("fields")).toBeNull();
    expect(input.searchParams.get("date_posted")).toBe("month");
    expect(init.headers).toEqual({ "x-api-key": "server-secret" });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).not.toHaveProperty("description");
    expect(JSON.stringify(jobs)).not.toContain("server-secret");
  });

  it("does not call the provider without a configured key", async () => {
    const client = new JSearchClient(undefined, fetchMock as typeof fetch);
    await expect(
      client.search(PROFILE, new AbortController().signal),
    ).rejects.toBeInstanceOf(JSearchConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a provider failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const client = new JSearchClient("server-secret", fetchMock as typeof fetch);
    await expect(
      client.search(PROFILE, new AbortController().signal),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("parseJSearchResponse", () => {
  it("supports the legacy flat data array and ignores unsafe apply links", () => {
    expect(
      parseJSearchResponse({
        data: [
          providerJob("1"),
          { ...providerJob("2"), job_apply_link: "javascript:alert(1)" },
        ],
      }),
    ).toHaveLength(1);
  });
});
