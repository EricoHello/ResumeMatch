import type { ResumeProfile } from "@/lib/analysis/types";
import type { JobPreferences } from "@/lib/preferences/types";

import type { JobCandidate, JobMatch } from "./types";

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "or",
  "the",
  "to",
]);

const GENERIC_ROLE_WORDS = new Set([
  "associate",
  "chief",
  "developer",
  "director",
  "engineer",
  "head",
  "junior",
  "lead",
  "manager",
  "officer",
  "principal",
  "senior",
  "specialist",
  "staff",
]);

const SEATTLE_METRO_LOCATIONS = new Set([
  "bellevue",
  "issaquah",
  "kent",
  "kirkland",
  "redmond",
  "renton",
  "seattle",
  "tukwila",
]);

function normalizedText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(
    normalizedText(value)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)),
  );
}

function overlapCount(left: Set<string>, right: Set<string>) {
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches;
}

function overlapRatio(left: Set<string>, right: Set<string>) {
  return left.size === 0 ? 0 : overlapCount(left, right) / left.size;
}

function preferredLocations(preferences: JobPreferences) {
  return [preferences.targetLocation, ...preferences.additionalLocations];
}

function primaryLocationName(value: string) {
  const normalized = normalizedText(value.split(",", 1)[0] ?? value);
  if (SEATTLE_METRO_LOCATIONS.has(normalized)) return "seattle-metro";
  return normalized;
}

function locationsMatch(desired: string, actual: string) {
  const desiredName = primaryLocationName(desired);
  const actualName = primaryLocationName(actual);
  if (!desiredName || !actualName || /^remote$/i.test(desired)) return false;

  const desiredPhrase = ` ${desiredName} `;
  const actualPhrase = ` ${actualName} `;
  return (
    desiredName === actualName ||
    actualPhrase.includes(desiredPhrase) ||
    desiredPhrase.includes(actualPhrase)
  );
}

function locationEligible(candidate: JobCandidate, preferences: JobPreferences) {
  if (candidate.isRemote) return true;
  return preferredLocations(preferences).some((location) =>
    locationsMatch(location, candidate.location),
  );
}

function locationScore(candidate: JobCandidate, preferences: JobPreferences) {
  const actualLocation = normalizedText(candidate.location);
  return Math.max(
    0,
    ...preferredLocations(preferences).map((location) => {
      if (locationsMatch(location, candidate.location)) return 40;
      const desiredLocation = normalizedText(location);
      if (desiredLocation && actualLocation.includes(desiredLocation)) return 40;
      return overlapRatio(tokens(location), tokens(candidate.location)) * 24;
    }),
  );
}

function workArrangementScore(
  candidate: JobCandidate,
  preference: JobPreferences["workArrangement"],
) {
  if (preference === "any") return candidate.isRemote ? 8 : 0;
  if (preference === "remote") return candidate.isRemote ? 34 : -24;
  if (candidate.workArrangement === "unknown") return 0;
  if (preference === "hybrid") {
    return candidate.workArrangement === "hybrid" ? 30 : -18;
  }
  if (candidate.workArrangement === "in_person") return 26;
  return candidate.workArrangement === "hybrid" ? -8 : -20;
}

function annualSalary(candidate: JobCandidate) {
  const multiplier: Record<string, number> = {
    hour: 2_080,
    hourly: 2_080,
    day: 260,
    daily: 260,
    week: 52,
    weekly: 52,
    month: 12,
    monthly: 12,
    year: 1,
    yearly: 1,
    annual: 1,
  };
  const period = candidate.salaryPeriod?.toLowerCase() ?? "year";
  const factor = multiplier[period] ?? 1;
  return {
    minimum:
      candidate.minimumSalary === null
        ? null
        : candidate.minimumSalary * factor,
    maximum:
      candidate.maximumSalary === null
        ? null
        : candidate.maximumSalary * factor,
  };
}

function recencyScore(postedTimestamp: number | null, now: number) {
  if (postedTimestamp === null) return 0;
  const ageDays = Math.max(0, (now - postedTimestamp * 1_000) / 86_400_000);
  if (ageDays <= 3) return 15;
  if (ageDays <= 7) return 12;
  if (ageDays <= 14) return 8;
  if (ageDays <= 30) return 3;
  return 0;
}

function signalMatches(
  values: string[],
  searchableTokens: Set<string>,
  text: string,
) {
  return values.filter((value, index, all) => {
    const normalized = normalizedText(value);
    if (
      normalized.length < 2 ||
      all.findIndex((item) => normalizedText(item) === normalized) !== index
    ) {
      return false;
    }

    if (text.includes(normalized)) return true;
    const valueTokens = tokens(value);
    return (
      valueTokens.size > 1 &&
      overlapRatio(valueTokens, searchableTokens) >= 0.6
    );
  });
}

function roleRelationship(role: string, title: string) {
  const normalizedRole = normalizedText(role);
  const normalizedTitle = normalizedText(title);
  const roleTokens = tokens(role);
  const titleTokens = tokens(title);
  const overlap = overlapRatio(roleTokens, titleTokens);
  const distinctiveRoleTokens = new Set(
    [...roleTokens].filter((token) => !GENERIC_ROLE_WORDS.has(token)),
  );
  const distinctiveOverlap = overlapCount(distinctiveRoleTokens, titleTokens);

  return {
    exact: normalizedRole === normalizedTitle,
    phrase:
      normalizedTitle.includes(normalizedRole) ||
      normalizedRole.includes(normalizedTitle),
    overlap,
    reasonablyRelated:
      normalizedRole === normalizedTitle ||
      normalizedTitle.includes(normalizedRole) ||
      normalizedRole.includes(normalizedTitle) ||
      distinctiveOverlap > 0 ||
      overlap >= 0.66,
  };
}

function scoreCandidate(
  candidate: JobCandidate,
  profile: ResumeProfile,
  now: number,
) {
  const searchableText = normalizedText(
    `${candidate.title} ${candidate.description}`,
  );
  const searchableTokens = tokens(searchableText);

  const roleRelationships = profile.targetRoles.map((role, index) => {
    const relationship = roleRelationship(role, candidate.title);
    const score = relationship.exact
      ? 95 - index * 3
      : relationship.phrase
        ? 72 - index * 3
        : relationship.overlap * (52 - index * 2);
    return { ...relationship, score };
  });
  let score = Math.max(0, ...roleRelationships.map((item) => item.score));

  const matchedSkills = signalMatches(
    [...profile.skills, ...profile.searchKeywords],
    searchableTokens,
    searchableText,
  ).slice(0, 4);
  score += Math.min(24, matchedSkills.length * 6);

  score += locationScore(candidate, profile.preferences);
  score += workArrangementScore(
    candidate,
    profile.preferences.workArrangement,
  );

  const salary = annualSalary(candidate);
  const minimumDesired = profile.preferences.minimumSalary;
  if (salary.maximum !== null && salary.maximum < minimumDesired) {
    // Known below-preference pay is a modest ranking penalty, never a filter.
    score -= 18;
  } else if (
    (salary.minimum !== null && salary.minimum >= minimumDesired) ||
    (salary.maximum !== null && salary.maximum >= minimumDesired)
  ) {
    score += 20;
  }

  score += recencyScore(candidate.postedTimestamp, now);
  if (candidate.applyUrl) score += 2;

  const recentTitleRelationship = profile.recentJobTitles.some(
    (title) => roleRelationship(title, candidate.title).reasonablyRelated,
  );
  const reasonablyRelated =
    roleRelationships.some((item) => item.reasonablyRelated) ||
    recentTitleRelationship ||
    matchedSkills.length > 0;

  return { score, matchedSkills, reasonablyRelated };
}

function toJobMatch(candidate: JobCandidate, matchedSkills: string[]): JobMatch {
  return {
    id: candidate.id,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    salary: candidate.salary,
    applyUrl: candidate.applyUrl,
    postedAt: candidate.postedAt,
    employmentType: candidate.employmentType,
    isRemote: candidate.isRemote,
    matchedSkills,
  };
}

export type RankedJobSummary = {
  title: string;
  score: number;
};

export type JobRankingResult = {
  jobs: JobMatch[];
  remainingAfterFiltering: number;
  topRanked: RankedJobSummary[];
};

export function rankJobCandidatesWithDiagnostics(
  candidates: JobCandidate[],
  profile: ResumeProfile,
  now = Date.now(),
): JobRankingResult {
  const seen = new Set<string>();
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      ...scoreCandidate(candidate, profile, now),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ candidate, reasonablyRelated }) => {
      if (
        !reasonablyRelated ||
        !locationEligible(candidate, profile.preferences)
      ) {
        return false;
      }
      const key = normalizedText(
        `${candidate.title}|${candidate.company}|${candidate.location}`,
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    jobs: ranked
      .slice(0, 3)
      .map(({ candidate, matchedSkills }) =>
        toJobMatch(candidate, matchedSkills),
      ),
    remainingAfterFiltering: ranked.length,
    topRanked: ranked.slice(0, 5).map(({ candidate, score }) => ({
      title: candidate.title,
      score: Math.round(score * 10) / 10,
    })),
  };
}

export function rankJobCandidatesByPreferencesWithDiagnostics(
  candidates: JobCandidate[],
  preferences: JobPreferences,
  now = Date.now(),
): JobRankingResult {
  const seen = new Set<string>();
  const available = candidates
    .map((candidate, index) => {
      let score = locationScore(candidate, preferences);
      score += workArrangementScore(candidate, preferences.workArrangement);

      const salary = annualSalary(candidate);
      if (
        salary.maximum !== null &&
        salary.maximum < preferences.minimumSalary
      ) {
        score -= 18;
      } else if (
        (salary.minimum !== null &&
          salary.minimum >= preferences.minimumSalary) ||
        (salary.maximum !== null &&
          salary.maximum >= preferences.minimumSalary)
      ) {
        score += 20;
      }

      score += recencyScore(candidate.postedTimestamp, now);
      return { candidate, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ candidate }) => {
      if (!locationEligible(candidate, preferences)) return false;
      const key = normalizedText(
        `${candidate.title}|${candidate.company}|${candidate.location}`,
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    jobs: available
      .slice(0, 3)
      .map(({ candidate }) => toJobMatch(candidate, [])),
    remainingAfterFiltering: available.length,
    topRanked: available.slice(0, 5).map(({ candidate, score }) => ({
      title: candidate.title,
      score: Math.round(score * 10) / 10,
    })),
  };
}

export function rankJobCandidates(
  candidates: JobCandidate[],
  profile: ResumeProfile,
  now = Date.now(),
): JobMatch[] {
  return rankJobCandidatesWithDiagnostics(candidates, profile, now).jobs;
}
