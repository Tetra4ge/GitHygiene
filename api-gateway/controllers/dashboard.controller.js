const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const { rankFindings } = require('../services/ranking.service');
const { majorVersion } = require('../services/scoring.service');

async function resolveScope(userId) {
  const caller = await getCallerContext(userId);
  if (!caller) return null;
  return caller;
}

/**
 * GET /dashboard/summary — Phase 9 §5. One call, computed from each
 * repository's current state (there is no scan-history table in this
 * schema, so "latest scan" is simply the repository's current columns —
 * re-scanning never double counts, since these are overwritten in place,
 * not appended).
 */
const getSummary = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;

  try {
    const caller = await resolveScope(userId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'User profile not synchronized.' });
    }
    const isAdmin = caller.role === 'admin';
    const orgFilter = isAdmin ? '' : 'WHERE p.organization_id = $1';
    const orgParams = isAdmin ? [] : [caller.organization_id];

    const reposRes = await pgPool.query(
      `SELECT r.repository_id, r.repo_name, r.language, r.security_score, r.risk_level, r.last_scanned_at
       FROM repositories r
       JOIN projects p ON r.project_id = p.project_id
       ${orgFilter}`,
      orgParams
    );
    const repos = reposRes.rows;

    if (repos.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          empty: true,
          message: 'No repositories tracked yet — import one from the Repositories tab to get started.',
          reposTracked: 0,
          reposScanned: 0,
          averageScore: null,
          severityCounts: {},
          reachabilityCounts: {},
          fixFirst: [],
          riskiestRepos: [],
          ecosystemBreakdown: []
        }
      });
    }

    const repoIds = repos.map((r) => r.repository_id);
    const scanned = repos.filter((r) => r.security_score !== null);
    const averageScore = scanned.length
      ? Math.round(scanned.reduce((sum, r) => sum + r.security_score, 0) / scanned.length)
      : null;

    const findingsRes = await pgPool.query(
      `SELECT f.finding_id, f.osv_id, f.fixed_version, f.repository_id, f.dependency_id,
              d.package_name, d.is_direct, d.current_version, d.latest_version,
              ov.severity,
              r.repo_name,
              a.response -> 'reachability' AS reachability,
              a.response -> 'evidence' AS evidence
       FROM osv_findings f
       JOIN dependencies d ON d.dependency_id = f.dependency_id
       JOIN osv_vulnerabilities ov ON ov.osv_id = f.osv_id
       JOIN repositories r ON f.repository_id = r.repository_id
       LEFT JOIN LATERAL (
         SELECT response FROM ai_assessments aa
         WHERE aa.osv_id = f.osv_id AND aa.repository_id = f.repository_id AND aa.dependency_id = f.dependency_id
         ORDER BY aa.created_at DESC LIMIT 1
       ) a ON true
       WHERE f.repository_id = ANY($1::int[]) AND f.status = 'open'`,
      [repoIds]
    );

    const severityCounts = {};
    const reachabilityCounts = {};
    const rankingInput = [];

    for (const row of findingsRes.rows) {
      const severity = (row.severity || 'UNKNOWN').toUpperCase();
      severityCounts[severity] = (severityCounts[severity] || 0) + 1;

      const reachability = row.reachability ? String(row.reachability).replace(/"/g, '') : 'unknown';
      reachabilityCounts[reachability] = (reachabilityCounts[reachability] || 0) + 1;

      const installedMajor = majorVersion(row.current_version);
      const fixedMajor = majorVersion(row.fixed_version);
      rankingInput.push({
        finding_id: row.finding_id,
        osv_id: row.osv_id,
        repository_id: row.repository_id,
        repo_name: row.repo_name,
        package_name: row.package_name,
        severity,
        reachability,
        isDirect: row.is_direct,
        fixPublished: Boolean(row.fixed_version),
        majorVersionsBehind:
          installedMajor !== null && fixedMajor !== null ? Math.max(0, fixedMajor - installedMajor) : null,
        callSiteCount: row.evidence?.call_sites?.length ?? null,
        blastRadiusCount: 1 // graph-derived blast radius is a 503-tolerant best-effort elsewhere; default to 1 here to stay synchronous
      });
    }

    const ranked = rankFindings(rankingInput);
    const fixFirst = ranked.slice(0, 5).map((f) => ({
      finding_id: f.finding_id,
      repository_id: f.repository_id,
      repo_name: f.repo_name,
      package_name: f.package_name,
      severity: f.severity,
      reachability: f.reachability,
      difficulty: f.difficulty,
      rank: Math.round(f.rank * 100) / 100
    }));

    const riskiestRepos = [...scanned]
      .sort((a, b) => a.security_score - b.security_score)
      .slice(0, 5)
      .map((r) => ({ repository_id: r.repository_id, repo_name: r.repo_name, security_score: r.security_score, risk_level: r.risk_level }));

    const ecosystemRes = await pgPool.query(
      `SELECT ecosystem, COUNT(*) AS count
       FROM dependencies
       WHERE repository_id = ANY($1::int[]) AND ecosystem IS NOT NULL
       GROUP BY ecosystem
       ORDER BY count DESC`,
      [repoIds]
    );

    return res.status(200).json({
      success: true,
      data: {
        empty: false,
        reposTracked: repos.length,
        reposScanned: scanned.length,
        averageScore,
        severityCounts,
        reachabilityCounts,
        fixFirst,
        riskiestRepos,
        ecosystemBreakdown: ecosystemRes.rows.map((r) => ({ ecosystem: r.ecosystem, count: Number(r.count) }))
      }
    });
  } catch (error) {
    console.error('Dashboard Summary Error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error building dashboard summary.' });
  }
};

module.exports = { getSummary };
