const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const osv = require('../services/osv.service');
const { lookupLatestVersions } = require('../services/registry.service');
const { computeScore } = require('../services/scoring.service');
const { ensureOsvSchema } = require('../utils/schema-migrations.util');
const graph = require('../services/graph.service');

/** Re-reads everything this repository needs from Postgres and writes it to Neo4j. */
async function writeGraphForRepository(repositoryId) {
  const repoRes = await pgPool.query(
    `SELECT r.repo_name, p.organization_id, p.project_name
     FROM repositories r
     JOIN projects p ON r.project_id = p.project_id
     WHERE r.repository_id = $1`,
    [repositoryId]
  );
  if (repoRes.rows.length === 0) return;
  const { repo_name, organization_id, project_name } = repoRes.rows[0];

  const depsRes = await pgPool.query(
    `SELECT package_name, current_version, ecosystem, package_manager
     FROM dependencies
     WHERE repository_id = $1 AND current_version IS NOT NULL AND ecosystem IS NOT NULL`,
    [repositoryId]
  );
  const packages = depsRes.rows.map((d) => ({
    ecosystem: d.ecosystem,
    name: d.package_name,
    version: d.current_version
  }));

  const edgesRes = await pgPool.query(
    `SELECT parent_name, child_name FROM dependency_edges WHERE repository_id = $1`,
    [repositoryId]
  );
  // Direct dependencies have no recorded parent edge from the parser when a
  // bare package.json fallback was used — fall back to "every direct
  // dependency depends directly on the repo" so the graph still has depth-1
  // edges even without a lockfile walk.
  const edges = edgesRes.rows.length
    ? edgesRes.rows.map((e) => ({ from: e.parent_name, to: e.child_name }))
    : [];
  const directDepsRes = await pgPool.query(
    `SELECT package_name FROM dependencies WHERE repository_id = $1 AND is_direct = true`,
    [repositoryId]
  );
  const edgeFromNames = new Set(edges.map((e) => e.to));
  for (const row of directDepsRes.rows) {
    if (!edgeFromNames.has(row.package_name)) {
      edges.push({ from: '__root__', to: row.package_name });
    }
  }

  const findingsRes = await pgPool.query(
    `SELECT f.osv_id, ov.severity, ov.summary, d.package_name
     FROM osv_findings f
     JOIN osv_vulnerabilities ov ON ov.osv_id = f.osv_id
     JOIN dependencies d ON d.dependency_id = f.dependency_id
     WHERE f.repository_id = $1 AND f.status = 'open'`,
    [repositoryId]
  );
  const findings = findingsRes.rows.map((r) => ({
    osvId: r.osv_id,
    severity: r.severity,
    summary: r.summary,
    packageName: r.package_name
  }));

  await graph.writeScanToGraph({
    repository: {
      id: String(repositoryId),
      fullName: `${project_name}/${repo_name}`,
      organizationId: String(organization_id)
    },
    packages,
    edges,
    findings
  });
}

/**
 * Phase 5 — real vulnerability scanning against OSV.dev, kept beside the
 * original ILIKE/cves scanner (scanner.controller.js) rather than replacing
 * it. Writes to osv_vulnerabilities (a global, permanent cache of advisory
 * bodies) and osv_findings (per repository/dependency), then recomputes the
 * repository's security score from real data.
 *
 * Pipeline: fetch dependencies -> OSV batch -> advisory details (cached)
 * -> registry lookups for direct deps -> score -> persist.
 */
async function assertRepoAccess(userId, repositoryId) {
  const caller = await getCallerContext(userId);
  const result = caller?.role === 'admin'
    ? await pgPool.query('SELECT repository_id FROM repositories WHERE repository_id = $1', [repositoryId])
    : await pgPool.query(
        `SELECT r.repository_id
         FROM repositories r
         JOIN projects p ON r.project_id = p.project_id
         JOIN users u ON p.organization_id = u.organization_id
         WHERE r.repository_id = $1 AND u.user_id = $2`,
        [repositoryId, userId]
      );
  return result.rows.length > 0;
}

const runOsvScan = async (req, res) => {
  const { repository_id } = req.body;
  const userId = req.user.sub || req.user.user_id;

  if (!repository_id) {
    return res.status(400).json({ success: false, message: 'Missing required parameter: repository_id.' });
  }

  try {
    await ensureOsvSchema();

    if (!(await assertRepoAccess(userId, repository_id))) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found or not accessible to your organization.'
      });
    }

    const depsRes = await pgPool.query(
      `SELECT dependency_id, package_name, current_version, latest_version, ecosystem, is_direct, is_deprecated
       FROM dependencies
       WHERE repository_id = $1 AND current_version IS NOT NULL`,
      [repository_id]
    );
    const dependencies = depsRes.rows;

    if (dependencies.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No dependencies recorded for this repository yet. Ingest and extract a manifest first.'
      });
    }

    // 1. OSV batch query for every dependency with a known ecosystem.
    const queryable = dependencies.filter((d) => d.ecosystem === 'npm' || d.ecosystem === 'PyPI');
    let batchResults;
    try {
      batchResults = await osv.queryBatch(
        queryable.map((d) => ({ ecosystem: d.ecosystem, name: d.package_name, version: d.current_version }))
      );
    } catch (err) {
      await pgPool.query(
        `UPDATE repositories SET last_scan_error = $1, last_scanned_at = NOW() WHERE repository_id = $2`,
        [err.message, repository_id]
      );
      return res.status(502).json({
        success: false,
        message: 'OSV.dev is unreachable — scan failed, nothing was marked safe.',
        error: err.message
      });
    }

    // 2. Collect every unique advisory id this repo needs, skip ones already cached.
    const allIds = new Set();
    for (const ids of batchResults.values()) ids.forEach((id) => allIds.add(id));

    const cachedRes = allIds.size
      ? await pgPool.query('SELECT osv_id FROM osv_vulnerabilities WHERE osv_id = ANY($1::text[])', [
          [...allIds]
        ])
      : { rows: [] };
    const cachedIds = new Set(cachedRes.rows.map((r) => r.osv_id));
    const idsToFetch = [...allIds].filter((id) => !cachedIds.has(id));

    const fetched = await osv.fetchVulnDetails(idsToFetch);
    for (const advisory of fetched.values()) {
      await pgPool.query(
        `INSERT INTO osv_vulnerabilities (osv_id, aliases, severity, summary, details, raw)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (osv_id) DO NOTHING`,
        [advisory.osv_id, advisory.aliases, advisory.severity, advisory.summary, advisory.details, advisory.raw]
      );
    }

    // 3. Re-read every advisory this scan needs (cached + just-fetched) to
    //    derive each one's package-specific fixed_version.
    const neededRes = allIds.size
      ? await pgPool.query('SELECT * FROM osv_vulnerabilities WHERE osv_id = ANY($1::text[])', [[...allIds]])
      : { rows: [] };
    const advisoryById = new Map(neededRes.rows.map((r) => [r.osv_id, r]));

    // 4. Write osv_findings, one per (dependency, advisory) pair.
    let newFindings = 0;
    for (const dep of queryable) {
      const key = `${dep.ecosystem}:${dep.package_name}@${dep.current_version}`;
      const ids = batchResults.get(key) || [];
      for (const osvId of ids) {
        const advisory = advisoryById.get(osvId);
        if (!advisory) continue;
        const fixedVersion = osv.extractFixedVersion(advisory.raw, dep.ecosystem, dep.package_name);
        const inserted = await pgPool.query(
          `INSERT INTO osv_findings (repository_id, dependency_id, osv_id, fixed_version)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (dependency_id, osv_id) DO UPDATE SET fixed_version = EXCLUDED.fixed_version
           RETURNING finding_id`,
          [repository_id, dep.dependency_id, osvId, fixedVersion]
        );
        if (inserted.rows.length) newFindings += 1;
      }
    }

    // Findings for dependencies that no longer resolve (e.g. re-scanned with
    // a fix applied) shouldn't linger — drop any finding whose dependency no
    // longer reports that advisory id in this scan. Built with unnest(), not
    // string interpolation, since osv_id comes from an external API response.
    const keepDepIds = [];
    const keepOsvIds = [];
    for (const dep of queryable) {
      const key = `${dep.ecosystem}:${dep.package_name}@${dep.current_version}`;
      for (const osvId of batchResults.get(key) || []) {
        keepDepIds.push(dep.dependency_id);
        keepOsvIds.push(osvId);
      }
    }
    await pgPool.query(
      `DELETE FROM osv_findings
       WHERE repository_id = $1
         AND dependency_id = ANY($2::int[])
         AND NOT EXISTS (
           SELECT 1 FROM unnest($3::int[], $4::text[]) AS keep(dep_id, osv_id)
           WHERE keep.dep_id = osv_findings.dependency_id AND keep.osv_id = osv_findings.osv_id
         )`,
      [repository_id, queryable.map((d) => d.dependency_id), keepDepIds, keepOsvIds]
    );

    // 5. Registry lookups — direct dependencies only.
    const directDeps = dependencies.filter((d) => d.is_direct && (d.ecosystem === 'npm' || d.ecosystem === 'PyPI'));
    const registryInfo = await lookupLatestVersions(
      directDeps.map((d) => ({ name: d.package_name, version: d.current_version, ecosystem: d.ecosystem }))
    );
    for (const dep of directDeps) {
      const info = registryInfo.get(dep.package_name);
      if (!info || !info.latest) continue;
      await pgPool.query(
        `UPDATE dependencies SET latest_version = $1, is_deprecated = $2 WHERE dependency_id = $3`,
        [info.latest, info.deprecated, dep.dependency_id]
      );
    }

    // 6. Score — findings with current severities, plus freshly-updated dependency rows.
    const findingsForScore = await pgPool.query(
      `SELECT ov.severity
       FROM osv_findings f
       JOIN osv_vulnerabilities ov ON ov.osv_id = f.osv_id
       WHERE f.repository_id = $1 AND f.status = 'open'`,
      [repository_id]
    );
    const depsForScore = await pgPool.query(
      `SELECT is_direct, is_deprecated, current_version, latest_version FROM dependencies WHERE repository_id = $1`,
      [repository_id]
    );
    const { score, riskLevel, breakdown } = computeScore(findingsForScore.rows, depsForScore.rows);

    await pgPool.query(
      `UPDATE repositories
       SET security_score = $1, risk_level = $2, score_breakdown = $3, last_scanned_at = NOW(), last_scan_error = NULL
       WHERE repository_id = $4`,
      [score, riskLevel, breakdown, repository_id]
    );

    // 7. Write to the dependency graph (Phase 6). Never fails the scan —
    //    graph writes are supporting infrastructure, logged and skipped on error.
    try {
      await writeGraphForRepository(repository_id);
      await pgPool.query('UPDATE repositories SET graph_error = NULL WHERE repository_id = $1', [repository_id]);
    } catch (graphErr) {
      console.error('Graph write failed (scan still succeeded):', graphErr.message);
      await pgPool
        .query('UPDATE repositories SET graph_error = $1 WHERE repository_id = $2', [graphErr.message, repository_id])
        .catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'OSV scan completed.',
      data: {
        repository_id,
        packagesChecked: queryable.length,
        advisoriesFound: allIds.size,
        newFindings,
        score,
        riskLevel,
        breakdown
      }
    });
  } catch (error) {
    console.error('OSV Scan Error:', error.message);
    try {
      await pgPool.query(
        `UPDATE repositories SET last_scan_error = $1, last_scanned_at = NOW() WHERE repository_id = $2`,
        [error.message, repository_id]
      );
    } catch (_) {}
    return res.status(500).json({
      success: false,
      message: 'OSV scan failed.',
      error: error.message
    });
  }
};

const getFindings = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { repository_id } = req.query;

  if (!repository_id) {
    return res.status(400).json({ success: false, message: 'Missing required query parameter: repository_id.' });
  }

  try {
    if (!(await assertRepoAccess(userId, repository_id))) {
      return res.status(404).json({ success: false, message: 'Repository not found or not accessible.' });
    }

    const result = await pgPool.query(
      `SELECT f.finding_id, f.osv_id, f.fixed_version, f.status, f.created_at,
              d.dependency_id, d.package_name, d.current_version, d.is_direct, d.ecosystem,
              ov.severity, ov.summary, ov.aliases
       FROM osv_findings f
       JOIN dependencies d ON f.dependency_id = d.dependency_id
       JOIN osv_vulnerabilities ov ON f.osv_id = ov.osv_id
       WHERE f.repository_id = $1
       ORDER BY
         CASE ov.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
         f.created_at DESC`,
      [repository_id]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get OSV Findings Error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving findings.' });
  }
};

module.exports = { runOsvScan, getFindings };
