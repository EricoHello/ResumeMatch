import type { ResumeProfile } from "@/lib/analysis/types";

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

function overlapRatio(left: Set<string>, right: Set<string>) {
  if (left.size === 0) return 0;
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches / left.size;
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

function scoreCandidate(
  candidate: JobCandidate,
  profile: ResumeProfile,
  now: number,
) {
  const title = normalizedText(candidate.title);
  const titleTokens = tokens(candidate.title);
  const searchableText = normalizedText(
    `${candidate.title} ${candidate.description}`,
  );
  let score = 0;

  for (const [index, role] of profile.targetRoles.entries()) {
    const normalizedRole = normalizedText(role);
    const roleOverlap = overlapRatio(tokens(role), titleTokens);
    if (title === normalizedRole) score += 95 - index * 3;
    else if (title.includes(normalizedRole) || normalizedRole.includes(title)) {
      score += 72 - index * 3;
    } else {
      score += roleOverlap * (52 - index * 2);
    }
  }

  const matchedSkills = [...profile.skills, ...profile.searchKeywords]
    .filter((value, index, all) => {
      const normalized = normalizedText(value);
      return (
        normalized.length > 1 &&
        searchableText.includes(normalized) &&
        all.findIndex((item) => normalizedText(item) === normalized) === index
      );
    })
    .slice(0, 4);
  score += Math.min(24, matchedSkills.length * 6);

  const desiredLocation = normalizedText(profile.preferences.targetLocation);
  const actualLocation = normalizedText(candidate.location);
  const wantsRemote = /\bremote\b/i.test(profile.preferences.targetLocation);
  if (wantsRemote && candidate.isRemote) score += 34;
  else if (actualLocation.includes(desiredLocation)) score += 32;
  else {
    score += overlapRatio(tokens(profile.preferences.targetLocation), tokens(candidate.location)) * 24;
    if (candidate.isRemote) score += 8;
  }

  const salary = annualSalary(candidate);
  const minimumDesired = profile.preferences.minimumSalary;
  if (
    salary.maximum !== null &&
    salary.maximum < minimumDesired
  ) {
    score -= 35;
  } else if (
    (salary.minimum !== null && salary.minimum >= minimumDesired) ||
    (salary.maximum !== null && salary.maximum >= minimumDesired)
  ) {
    score += 20;
  }

  score += recencyScore(candidate.postedTimestamp, now);
  if (candidate.applyUrl) score += 2;

  return { score, matchedSkills };
}

export function rankJobCandidates(
  candidates: JobCandidate[],
  profile: ResumeProfile,
  now = Date.now(),
): JobMatch[] {
  const seen = new Set<string>();

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      ...scoreCandidate(candidate, profile, now),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ candidate }) => {
      const key = normalizedText(
        `${candidate.title}|${candidate.company}|${candidate.location}`,
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map(({ candidate, matchedSkills }) => ({
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
    }));
}
