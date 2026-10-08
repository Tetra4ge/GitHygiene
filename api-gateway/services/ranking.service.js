// Phase 9 §2-3 — fix-first ranking and difficulty rating. Deterministic by
// design (AI_DESIGN.md §6): every input is a stored number (severity from
// OSV, reachability from the Phase 8 engine if it has run, blast radius from
// the Phase 6 graph, call-site count from Phase 7 Stage 2). Sorting them is
// an ORDER BY, not an inference — calling this "AI" is the kind of claim
// AGENTS.md §6 forbids.

// Documented weights, in one place, so the ordering can always be explained.
const SEVERITY_WEIGHT = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 1 };

// A finding Stage 3 has never assessed has no reachability yet — weighted
// between "likely_reachable" and "not_evidenced" rather than assumed either
// way, so un-assessed findings don't silently sink to the bottom or spike to
// the top of the list.
const REACHABILITY_WEIGHT = {
  reachable: 3,
  likely_reachable: 2,
  not_evidenced: 1,
  unused: 0.5,
  unknown: 1.5
};

const DIFFICULTY_EFFORT = { beginner: 1, intermediate: 2, advanced: 4 };

/**
 * finding: {
 *   severity, isDirect, majorVersionsBehind, fixPublished, callSiteCount,
 *   reachability, blastRadiusCount
 * }
 */
function difficultyFor(finding) {
  const { isDirect, majorVersionsBehind, fixPublished, callSiteCount } = finding;

  if (!isDirect || (majorVersionsBehind ?? 0) >= 1 || !fixPublished) {
    return 'advanced';
  }
  if (isDirect && fixPublished && (callSiteCount ?? 0) <= 3) {
    return 'beginner';
  }
  return 'intermediate';
}

function impactFor(finding) {
  const severityWeight = SEVERITY_WEIGHT[(finding.severity || 'UNKNOWN').toUpperCase()] ?? SEVERITY_WEIGHT.UNKNOWN;
  const reachabilityWeight = REACHABILITY_WEIGHT[finding.reachability || 'unknown'] ?? REACHABILITY_WEIGHT.unknown;
  const blastRadius = Math.max(1, finding.blastRadiusCount ?? 1);
  return severityWeight * reachabilityWeight * blastRadius;
}

/** Returns findings annotated with difficulty, impact, effort and rank, sorted fix-first. */
function rankFindings(findings) {
  return findings
    .map((f) => {
      const difficulty = difficultyFor(f);
      const impact = impactFor(f);
      const effort = DIFFICULTY_EFFORT[difficulty];
      return { ...f, difficulty, impact, effort, rank: impact / effort };
    })
    .sort((a, b) => b.rank - a.rank);
}

module.exports = { rankFindings, difficultyFor, impactFor, SEVERITY_WEIGHT, REACHABILITY_WEIGHT, DIFFICULTY_EFFORT };
