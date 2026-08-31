import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ResumeProfile } from "@/lib/analysis/types";
import {
  buildJSearchQuery,
  buildSmokeTestJSearchQuery,
  JSearchClient,
  JSearchConfigurationError,
  jSearchLocaleFor,
  parseJSearchResponse,
} from "@/lib/jobs/jsearch";

const PROFILE: ResumeProfile = {
  summary: "Senior platform engineer.",
  experienceLevel: "senior",
  skills: ["TypeScript", "Kubernetes"],
  recentJobTitles: ["Senior Software Engineer"],
  targetRoles: ["Staff Software Engineer", "Platform Engineer"],
  searchKeywords: ["distributed systems"],
  preferences: {
    targetLocation: "Seattle, WA",
    additionalLocations: [],
    radiusMiles: 25,
    workArrangement: "any",
    minimumSalary: 145_000,
  },
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
  let logInfo: Mock<(message: string, data: unknown) => void>;
  let logger: { info: (message: string, data: unknown) => void };

  beforeEach(() => {
    logInfo = vi.fn();
    logger = { info: (message, data) => logInfo(message, data) };
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { jobs: [providerJob("1"), providerJob("2")] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  it("uses one combined JSearch request and ranks locally", async () => {
    const client = new JSearchClient(
      "server-secret",
      fetchMock as typeof fetch,
      logger,
      false,
    );
    const jobs = await client.search(PROFILE, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(input.origin + input.pathname).toBe(
      "https://api.openwebninja.com/jsearch/search-v2",
    );
    expect(input.searchParams.get("query")).toContain("Staff Software Engineer");
    expect(input.searchParams.get("query")).not.toContain("distributed systems");
    expect(input.searchParams.get("query")).toContain("Seattle, WA");
    expect(input.searchParams.get("cursor")).toBeNull();
    expect(input.searchParams.get("num_pages")).toBeNull();
    expect(input.searchParams.get("fields")).toBeNull();
    expect(input.searchParams.get("date_posted")).toBeNull();
    expect(input.searchParams.get("work_from_home")).toBeNull();
    expect(init.headers).toEqual({ "x-api-key": "server-secret" });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).not.toHaveProperty("description");
    expect(JSON.stringify(jobs)).not.toContain("server-secret");
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] generated JSearch query",
      expect.stringContaining("Staff Software Engineer"),
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] resume matching enabled",
      true,
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] number of raw jobs returned",
      2,
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] number remaining after filtering",
      2,
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] top ranked scores/titles",
      expect.arrayContaining([
        expect.objectContaining({ title: "Staff Software Engineer" }),
      ]),
    );
  });

  it("does not call the provider without a configured key", async () => {
    const client = new JSearchClient(
      undefined,
      fetchMock as typeof fetch,
      logger,
      false,
    );
    await expect(
      client.search(PROFILE, new AbortController().signal),
    ).rejects.toBeInstanceOf(JSearchConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a provider failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const client = new JSearchClient(
      "server-secret",
      fetchMock as typeof fetch,
      logger,
      false,
    );
    await expect(
      client.search(PROFILE, new AbortController().signal),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("isolation mode ignores the resume and returns three preference-ranked jobs", async () => {
    const rawJobs = [
      ["a", "Dental Hygienist"],
      ["b", "Retail Store Manager"],
      ["c", "Truck Driver"],
      ["d", "Staff Accountant"],
    ].map(([id, title]) => ({ ...providerJob(id), job_title: title }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: rawJobs }), { status: 200 }),
    );
    const client = new JSearchClient(
      "server-secret",
      fetchMock as typeof fetch,
      logger,
      true,
    );

    const jobs = await client.search(PROFILE, new AbortController().signal);
    const [input] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input.searchParams.get("query")).toBe("jobs in Seattle, WA");
    expect(input.searchParams.get("query")).not.toContain("Software");
    expect(input.searchParams.get("query")).not.toContain("TypeScript");
    expect(jobs.map((job) => job.title)).toEqual([
      "Dental Hygienist",
      "Retail Store Manager",
      "Truck Driver",
    ]);
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] smoke-test mode enabled",
      true,
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[ResumeMatch job search] number remaining after filtering",
      4,
    );
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

  it("keeps jobs with null primary fields when safe fallbacks are available", () => {
    const [job] = parseJSearchResponse({
      data: [
        {
          ...providerJob("fallback"),
          job_apply_link: null,
          job_google_link: null,
          apply_options: [
            {
              apply_link: "https://employer.example.test/apply/fallback",
              is_direct: true,
            },
          ],
          job_location: null,
          job_city: "Seattle",
          job_state: "WA",
          job_country: "US",
          job_min_salary: "150000",
          job_max_salary: "180000",
          job_employment_type: null,
          job_employment_types: ["FULLTIME"],
          job_is_remote: null,
          work_arrangement: "remote",
        },
      ],
    });

    expect(job).toMatchObject({
      applyUrl: "https://employer.example.test/apply/fallback",
      location: "Seattle, WA, US",
      minimumSalary: 150000,
      maximumSalary: 180000,
      employmentType: "FULLTIME",
      isRemote: true,
      workArrangement: "remote",
    });
  });
});

describe("broad query construction", () => {
  it("builds a location-only query that contains no resume details in isolation mode", () => {
    expect(buildSmokeTestJSearchQuery(PROFILE)).toBe("jobs in Seattle, WA");
    expect(
      buildSmokeTestJSearchQuery({
        ...PROFILE,
        summary: "Completely different resume.",
        skills: ["Dentistry"],
        recentJobTitles: ["Dental Hygienist"],
        targetRoles: ["Dental Hygienist"],
        searchKeywords: ["patient care"],
      }),
    ).toBe("jobs in Seattle, WA");
    expect(
      buildSmokeTestJSearchQuery({
        ...PROFILE,
        preferences: {
          targetLocation: "London, United Kingdom",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "any",
          minimumSalary: 90_000,
        },
      }),
    ).toBe("jobs in London, United Kingdom");
    expect(
      buildSmokeTestJSearchQuery({
        ...PROFILE,
        preferences: {
          targetLocation: "Remote",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "remote",
          minimumSalary: 145_000,
        },
      }),
    ).toBe("remote jobs in United States");
  });

  it.each([
    {
      label: "software profile in a US city",
      profile: PROFILE,
      expected: "Staff Software Engineer jobs within 25 miles of Seattle, WA",
      locale: { country: "us", language: "en" },
    },
    {
      label: "specialized remote marketing profile",
      profile: {
        ...PROFILE,
        targetRoles: [
          "Senior Product Marketing Manager, B2B SaaS Growth",
          "Product Marketing Manager",
        ],
        searchKeywords: ["go-to-market strategy", "product launches", "SaaS"],
        preferences: {
          targetLocation: "Remote",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "remote",
          minimumSalary: 150_000,
        },
      },
      expected: "Product Marketing Manager jobs remote",
      locale: { country: "us", language: "en" },
    },
    {
      label: "finance profile in the United Kingdom",
      profile: {
        ...PROFILE,
        targetRoles: ["Senior Financial Analyst"],
        searchKeywords: ["financial planning", "forecasting"],
        preferences: {
          targetLocation: "London, United Kingdom",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "any",
          minimumSalary: 90_000,
        },
      },
      expected: "Senior Financial Analyst jobs within 25 miles of London, United Kingdom",
      locale: { country: "gb", language: "en" },
    },
  ])("builds one compact query for $label", ({ profile, expected, locale }) => {
    expect(buildJSearchQuery(profile as ResumeProfile)).toBe(expected);
    expect(jSearchLocaleFor(profile.preferences.targetLocation)).toEqual(locale);
  });

  it("broadens the reproduced robotics resume query to its supported metro role", () => {
    expect(
      buildJSearchQuery({
        ...PROFILE,
        experienceLevel: "mid",
        recentJobTitles: [
          "Robotics Operations Engineer",
          "Endpoint Systems Support Technician",
        ],
        targetRoles: [
          "Robotics Operations Engineer",
          "Robotics Engineer",
          "Automation Engineer",
          "Systems Support Engineer",
        ],
        searchKeywords: [
          "Robotics Operations",
          "Autonomous Systems",
          "Fleet Readiness",
        ],
        preferences: {
          targetLocation: "Renton",
          additionalLocations: [],
          radiusMiles: 25,
          workArrangement: "any",
          minimumSalary: 100_000,
        },
      }),
    ).toBe("Robotics Engineer jobs within 25 miles of Seattle, WA");
  });

  it("includes multiple cities, radius, and work arrangement in the query", () => {
    expect(
      buildJSearchQuery({
        ...PROFILE,
        preferences: {
          ...PROFILE.preferences,
          additionalLocations: ["Portland, OR"],
          radiusMiles: 50,
          workArrangement: "hybrid",
        },
      }),
    ).toBe(
      "Staff Software Engineer jobs hybrid within 50 miles of Seattle, WA or Portland, OR",
    );
  });

  it("uses the provider's remote-only filter for remote searches", async () => {
    const localFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { jobs: [providerJob("remote")] } }), {
        status: 200,
      }),
    );
    const client = new JSearchClient(
      "server-secret",
      localFetch as typeof fetch,
      { info: vi.fn() },
      false,
    );

    await client.search(
      {
        ...PROFILE,
        preferences: {
          ...PROFILE.preferences,
          workArrangement: "remote",
        },
      },
      new AbortController().signal,
    );

    const [input] = localFetch.mock.calls[0] as [URL, RequestInit];
    expect(input.searchParams.get("work_from_home")).toBe("true");
  });

  it("never adds every target role or the full skill list", () => {
    const query = buildJSearchQuery({
      ...PROFILE,
      skills: ["TypeScript", "Kubernetes", "AWS", "React", "Node.js"],
      targetRoles: [
        "Staff Software Engineer",
        "Platform Engineer",
        "Backend Engineer",
      ],
      searchKeywords: ["distributed systems", "cloud infrastructure", "APIs"],
    });

    expect(query).not.toContain("Platform Engineer");
    expect(query).not.toContain("Backend Engineer");
    expect(query).not.toContain("Kubernetes");
    expect(query).not.toContain("cloud infrastructure");
  });
});
