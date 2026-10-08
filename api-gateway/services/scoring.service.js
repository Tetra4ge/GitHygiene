// Phase 5 §3.5 / TRD §8 — pure scoring function. Starts at 100, floored at 0.
// Deliberately simple and shown in the UI so a score can always be explained.
// Ranks *repositories*; ranking findings within one repository is the
// reachability-weighted ranking in Phase 9, which needs Phase 8.

const PENALTIES = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 7,
  LOW: 2,
  UNKNOWN: 2
};

const DEPRECATED_DIRECT_PENALTY = 5;
const MAJOR_VERSION_BEHIND_PENALTY = 1;
const MAJOR_VERSION_BEHIND_CAP = 10;

function riskLevelFor(score) {
  if (score >= 80) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'high';
  return 'critical';
}

function majorVersion(versionString) {
  const match = /^(\d+)/.exec(String(versionString || ''));
  return match ? Number(match[1]) : null;
}

/**
 * findings: [{ severity }] — one row per open OSV finding.
 * dependencies: [{ is_direct, is_deprecated, current_version, latest_version }]
 * Returns { score, riskLevel, breakdown }.
 */
function computeScore(findings, dependencies) {
  const breakdown = {
    vulnerabilities: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    deprecatedDirectCount: 0,
    majorVersionsBehindCount: 0,
    penalties: { vulnerabilities: 0, deprecated: 0, outdated: 0 }
  };

  let score = 100;

  for (const finding of findings) {
    const severity = (finding.severity || 'UNKNOWN').toUpperCase();
    const key = PENALTIES[severity] !== undefined ? severity : 'UNKNOWN';
    breakdown.vulnerabilities[key] += 1;
    const penalty = PENALTIES[key];
    breakdown.penalties.vulnerabilities += penalty;
    score -= penalty;
  }

  let majorBehindPenalty = 0;
  for (const dep of dependencies || []) {
    if (!dep.is_direct) continue;

    if (dep.is_deprecated) {
      breakdown.deprecatedDirectCount += 1;
      breakdown.penalties.deprecated += DEPRECATED_DIRECT_PENALTY;
      score -= DEPRECATED_DIRECT_PENALTY;
    }

    const installedMajor = majorVersion(dep.current_version);
    const latestMajor = majorVersion(dep.latest_version);
    if (installedMajor !== null && latestMajor !== null && latestMajor > installedMajor) {
      breakdown.majorVersionsBehindCount += 1;
      majorBehindPenalty += MAJOR_VERSION_BEHIND_PENALTY;
    }
  }
  majorBehindPenalty = Math.min(majorBehindPenalty, MAJOR_VERSION_BEHIND_CAP);
  breakdown.penalties.outdated = majorBehindPenalty;
  score -= majorBehindPenalty;

  score = Math.max(0, Math.round(score));

  return { score, riskLevel: riskLevelFor(score), breakdown };
}

module.exports = { computeScore, riskLevelFor, PENALTIES, majorVersion };
