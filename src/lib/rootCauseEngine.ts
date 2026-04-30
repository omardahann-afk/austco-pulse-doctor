import type { DiagnosticIssue } from "./types";

const SEVERITY_RANK: Record<DiagnosticIssue["severity"], number> = {
  Critical: 3,
  Warning: 2,
  Info: 1,
};
const CONFIDENCE_RANK: Record<DiagnosticIssue["confidence"], number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

/**
 * Rank issues by impact: severity first, then confidence, then evidence weight.
 * Critical priorities (server unreachable, queue stopped, controller offline,
 * output not acked, IP-APP1 stuck, IP-IN8 held active, switch port loss,
 * replication delay) are pre-weighted via keyword boosts.
 */
const KEYWORD_BOOSTS: Array<{ match: RegExp; boost: number }> = [
  { match: /unreachable|offline|down/i, boost: 5 },
  { match: /event queue stopped|queue halted/i, boost: 5 },
  { match: /controller.*not acknowledge|output.*not.*ack/i, boost: 4 },
  { match: /stuck call|stale.*session/i, boost: 3 },
  { match: /held active/i, boost: 2 },
  { match: /packet (loss|errors?)|crc/i, boost: 2 },
  { match: /replication delay/i, boost: 1 },
];

function keywordBoost(issue: DiagnosticIssue): number {
  const haystack = `${issue.title} ${issue.whatIsHappening} ${issue.evidence.join(" ")}`;
  return KEYWORD_BOOSTS.reduce((acc, { match, boost }) => acc + (match.test(haystack) ? boost : 0), 0);
}

export function scoreIssue(issue: DiagnosticIssue): number {
  return (
    SEVERITY_RANK[issue.severity] * 10 +
    CONFIDENCE_RANK[issue.confidence] * 3 +
    issue.evidence.length * 0.5 +
    keywordBoost(issue)
  );
}

export function rankRootCauses(issues: DiagnosticIssue[]): DiagnosticIssue[] {
  return [...issues].sort((a, b) => scoreIssue(b) - scoreIssue(a));
}