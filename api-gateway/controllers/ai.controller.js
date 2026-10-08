// Phases 7-8 — api-gateway side of the engine. Assembles context from
// Postgres/Neo4j/GitHub, runs the deterministic Stage 2 evidence search,
// calls ai-service for Stages 1 and 3, and caches both. ai-service never
// sees a database credential; everything it needs arrives in the request body.

const axios = require('axios');
const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const { ensureAiSchema } = require('../utils/ai-schema.util');
const ai = require('../services/ai.service');
const evidence = require('../services/evidence.service');
const graph = require('../services/graph.service');
const { buildPatch } = require('../services/remediation.service');
const { majorVersion } = require('../services/scoring.service');
const { rankFindings } = require('../services/ranking.service');

async function assertRepoAccess(userId, repositoryId) {
  const caller = await getCallerContext(userId);
  const result = caller?.role === 'admin'
    ? await pgPool.query(
        `SELECT r.repository_id, r.repo_name, r.default_branch, p.organization_id
         FROM repositories r JOIN projects p ON r.project_id = p.project_id
         WHERE r.repository_id = $1`,
        [repositoryId]
      )
    : await pgPool.query(
        `SELECT r.repository_id, r.repo_name, r.default_branch, p.organization_id
         FROM repositories r
         JOIN projects p ON r.project_id = p.project_id
         JOIN users u ON p.organization_id = u.organization_id
         WHERE r.repository_id = $1 AND u.user_id = $2`,
        [repositoryId, userId]
      );
  return result.rows[0] || null;
}

/** Stage 1, cached by advisory id, platform-wide and effectively permanent. */
async function getOrExtractSurface(osvId) {
  const cached = await pgPool.query('SELECT * FROM advisory_surfaces WHERE osv_id = $1', [osvId]);
  if (cached.rows.length > 0) return cached.rows[0];

  const advisoryRes = await pgPool.query('SELECT * FROM osv_vulnerabilities WHERE osv_id = $1', [osvId]);
  if (advisoryRes.rows.length === 0) throw new Error(`Advisory ${osvId} not found in cache.`);
  const advisory = advisoryRes.rows[0];
  const raw = advisory.raw || {};

  // If an ecosystem_specific block already names functions, skip the model
  // call entirely — free and exact beats inferred (Phase_07.md §3).
  const findingRes = await pgPool.query(
    `SELECT d.ecosystem, d.package_name FROM osv_findings f JOIN dependencies d ON d.dependency_id = f.dependency_id
     WHERE f.osv_id = $1 LIMIT 1`,
    [osvId]
  );
  const ecosystem = findingRes.rows[0]?.ecosystem || 'npm';
  const packageName = findingRes.rows[0]?.package_name || '';

  const ecosystemSpecific = (raw.affected || []).find(
    (a) => a.package?.ecosystem === ecosystem && a.package?.name === packageName
  )?.ecosystem_specific;
  const namedFunctions = ecosystemSpecific?.functions || ecosystemSpecific?.affected_functions;

  let surface;
  if (Array.isArray(namedFunctions) && namedFunctions.length > 0) {
    surface = {
      vulnerable_symbols: namedFunctions,
      vulnerable_subpaths: [],
      vulnerable_configs: [],
      trigger_conditions: [],
      attack_vector: '',
      needs_untrusted_input: false,
      exploit_requires_runtime: 'unknown',
      extraction_confidence: 'high',
      notes: 'Taken directly from the advisory\'s ecosystem_specific field — no model call.',
      model: 'none (ecosystem_specific)',
      from_ecosystem_specific: true
    };
  } else {
    surface = await ai.extractSurface({
      osv_id: osvId,
      aliases: advisory.aliases || [],
      summary: advisory.summary || '',
      details: advisory.details,
      ecosystem,
      package_name: packageName
    });
  }

  const insertRes = await pgPool.query(
    `INSERT INTO advisory_surfaces
       (osv_id, vulnerable_symbols, vulnerable_subpaths, vulnerable_configs, trigger_conditions,
        attack_vector, needs_untrusted_input, exploit_requires_runtime, extraction_confidence, notes,
        model, from_ecosystem_specific)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (osv_id) DO NOTHING
     RETURNING *`,
    [
      osvId,
      surface.vulnerable_symbols,
      surface.vulnerable_subpaths,
      surface.vulnerable_configs,
      surface.trigger_conditions,
      surface.attack_vector,
      surface.needs_untrusted_input,
      surface.exploit_requires_runtime,
      surface.extraction_confidence,
      surface.notes,
      surface.model,
      surface.from_ecosystem_specific
    ]
  );
  return insertRes.rows[0] || (await pgPool.query('SELECT * FROM advisory_surfaces WHERE osv_id = $1', [osvId])).rows[0];
}

const extractSurface = async (req, res) => {
  const { osv_id } = req.body;
  if (!osv_id) return res.status(400).json({ success: false, message: 'Missing required parameter: osv_id.' });

  try {
    await ensureAiSchema();
    const surface = await getOrExtractSurface(osv_id);
    return res.status(200).json({ success: true, data: surface });
  } catch (error) {
    const status = error.status === 503 ? 503 : 500;
    return res.status(status).json({ success: false, message: 'Stage 1 extraction failed.', error: error.message });
  }
};

/**
 * POST /ai/assess { finding_id, owner, repo_name, regenerate? }
 * header x-github-token
 */
const assessFinding = async (req, res) => {
  const { finding_id, regenerate } = req.body;
  const userId = req.user.sub || req.user.user_id;
  const githubToken = req.headers['x-github-token'];

  if (!finding_id) {
    return res.status(400).json({ success: false, message: 'Missing required parameter: finding_id.' });
  }
  if (!githubToken) {
    return res.status(400).json({ success: false, message: 'Missing required x-github-token authorization header.' });
  }

  let tarballDir = null;

  try {
    await ensureAiSchema();

    const findingRes = await pgPool.query(
      `SELECT f.finding_id, f.osv_id, f.fixed_version, f.repository_id, f.dependency_id,
              d.package_name, d.current_version, d.latest_version, d.is_direct, d.ecosystem, d.package_manager,
              ov.severity, ov.summary
       FROM osv_findings f
       JOIN dependencies d ON d.dependency_id = f.dependency_id
       JOIN osv_vulnerabilities ov ON ov.osv_id = f.osv_id
       WHERE f.finding_id = $1`,
      [finding_id]
    );
    if (findingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Finding not found.' });
    }
    const finding = findingRes.rows[0];

    const repoAccess = await assertRepoAccess(userId, finding.repository_id);
    if (!repoAccess) {
      return res.status(404).json({ success: false, message: 'Repository not found or not accessible.' });
    }

    const owner = req.body.owner;
    const repoName = req.body.repo_name || repoAccess.repo_name;
    if (!owner) {
      return res.status(400).json({ success: false, message: 'Missing required parameter: owner (GitHub org/user).' });
    }

    // Resolve the current commit sha — Stage 3's cache key includes it
    // because the verdict is about code, and new code deserves a new verdict.
    const branch = repoAccess.default_branch || 'main';
    let commitSha;
    try {
      const commitRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/commits/${branch}`,
        { headers: { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3+json' } }
      );
      commitSha = commitRes.data.sha;
    } catch (err) {
      return res.status(502).json({
        success: false,
        message: `Could not resolve the current commit for ${owner}/${repoName}@${branch}.`,
        error: err.message
      });
    }

    if (!regenerate) {
      const cached = await pgPool.query(
        `SELECT * FROM ai_assessments
         WHERE osv_id = $1 AND repository_id = $2 AND dependency_id = $3 AND installed_version = $4 AND commit_sha = $5`,
        [finding.osv_id, finding.repository_id, finding.dependency_id, finding.current_version, commitSha]
      );
      if (cached.rows.length > 0) {
        return res.status(200).json({ success: true, cached: true, data: formatAssessmentRow(cached.rows[0]) });
      }
    }

    // Stage 1 (cached by advisory id).
    const surfaceRow = await getOrExtractSurface(finding.osv_id);
    const symbols = surfaceRow.vulnerable_symbols || [];

    // Stage 2 — deterministic evidence retrieval.
    let evidenceResult;
    try {
      const fetched = await evidence.fetchRepoTarball(owner, repoName, commitSha, githubToken);
      tarballDir = fetched.dir;
      evidenceResult = await evidence.searchEvidence(tarballDir, finding.ecosystem, finding.package_name, symbols);
      evidenceResult.truncated = evidenceResult.truncated || fetched.truncated;
    } catch (err) {
      return res.status(502).json({
        success: false,
        message: 'Could not fetch or search the repository for evidence.',
        error: err.message
      });
    }

    // Dependency path from the graph — best-effort, "unknown" if Neo4j is down.
    let dependencyPath = null;
    try {
      const pathResult = await graph.getDependencyPath(
        repoAccess.organization_id,
        finding.repository_id,
        finding.ecosystem,
        finding.package_name,
        finding.current_version
      );
      dependencyPath = pathResult.chain;
    } catch (err) {
      console.error('Dependency path lookup failed (graph unavailable):', err.message);
    }

    const installedMajor = majorVersion(finding.current_version);
    const fixedMajor = majorVersion(finding.fixed_version);

    const assessPayload = {
      osv_id: finding.osv_id,
      severity: finding.severity,
      summary: finding.summary,
      surface: {
        vulnerable_symbols: surfaceRow.vulnerable_symbols || [],
        vulnerable_subpaths: surfaceRow.vulnerable_subpaths || [],
        vulnerable_configs: surfaceRow.vulnerable_configs || [],
        trigger_conditions: surfaceRow.trigger_conditions || [],
        attack_vector: surfaceRow.attack_vector || '',
        needs_untrusted_input: surfaceRow.needs_untrusted_input || false,
        exploit_requires_runtime: surfaceRow.exploit_requires_runtime || 'unknown',
        extraction_confidence: surfaceRow.extraction_confidence || 'low',
        notes: surfaceRow.notes || ''
      },
      evidence: evidenceResult,
      dependency: {
        is_direct: finding.is_direct,
        installed_version: finding.current_version,
        fixed_version: finding.fixed_version,
        latest_version: finding.latest_version,
        major_versions_behind:
          installedMajor !== null && fixedMajor !== null ? Math.max(0, fixedMajor - installedMajor) : null,
        is_dev_dependency: false,
        dependency_path: dependencyPath,
        package_manager: finding.package_manager
      },
      repository: {
        kind: 'unknown',
        entry_point_files: [],
        package_manager: finding.package_manager
      }
    };

    let verdict;
    try {
      verdict = await ai.assess(assessPayload);
    } catch (err) {
      const status = err.status === 503 ? 503 : err.status === 502 ? 502 : 500;
      return res.status(status).json({ success: false, message: 'Stage 3 assessment failed.', error: err.message });
    }

    const { patch, note, filesToChange } = buildPatch({
      strategy: verdict.remediation_mechanics?.strategy,
      packageManager: finding.package_manager,
      packageName: finding.package_name,
      directDependencyName: verdict.remediation_mechanics?.direct_dependency,
      fixedVersion: finding.fixed_version
    });
    const remediation = {
      ...verdict.remediation_mechanics,
      patch,
      note,
      files_to_change: filesToChange || verdict.files_to_change
    };

    const insertRes = await pgPool.query(
      `INSERT INTO ai_assessments
         (osv_id, repository_id, dependency_id, installed_version, commit_sha, model, response, evidence, remediation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (osv_id, repository_id, dependency_id, installed_version, commit_sha)
       DO UPDATE SET model = EXCLUDED.model, response = EXCLUDED.response, evidence = EXCLUDED.evidence,
                      remediation = EXCLUDED.remediation, created_at = now()
       RETURNING *`,
      [
        finding.osv_id,
        finding.repository_id,
        finding.dependency_id,
        finding.current_version,
        commitSha,
        verdict.model,
        verdict,
        evidenceResult,
        remediation
      ]
    );

    return res.status(200).json({ success: true, cached: false, data: formatAssessmentRow(insertRes.rows[0]) });
  } catch (error) {
    console.error('AI Assessment Error:', error.message);
    return res.status(500).json({ success: false, message: 'AI assessment failed.', error: error.message });
  } finally {
    if (tarballDir) await evidence.cleanup(tarballDir);
  }
};

function formatAssessmentRow(row) {
  return {
    assessment_id: row.assessment_id,
    osv_id: row.osv_id,
    repository_id: row.repository_id,
    dependency_id: row.dependency_id,
    commit_sha: row.commit_sha,
    model: row.model,
    verdict: row.response,
    evidence: row.evidence,
    remediation: row.remediation,
    created_at: row.created_at
  };
}

/**
 * POST /ai/draft-issue { assessment_id } — Phase 9 §4. Draft-only: this never
 * calls GitHub's issues API (AGENTS.md, CLAUDE.md §13, TRD §11).
 */
const draftIssue = async (req, res) => {
  const { assessment_id } = req.body;
  const userId = req.user.sub || req.user.user_id;

  if (!assessment_id) {
    return res.status(400).json({ success: false, message: 'Missing required parameter: assessment_id.' });
  }

  try {
    await ensureAiSchema();

    const row = await pgPool.query(
      `SELECT a.*, d.package_name, d.is_direct, d.current_version, d.latest_version,
              f.fixed_version, ov.severity, ov.summary
       FROM ai_assessments a
       JOIN dependencies d ON d.dependency_id = a.dependency_id
       JOIN osv_findings f ON f.osv_id = a.osv_id AND f.dependency_id = a.dependency_id AND f.repository_id = a.repository_id
       JOIN osv_vulnerabilities ov ON ov.osv_id = a.osv_id
       WHERE a.assessment_id = $1`,
      [assessment_id]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Assessment not found. Run an assessment first.' });
    }
    const a = row.rows[0];

    if (!(await assertRepoAccess(userId, a.repository_id))) {
      return res.status(404).json({ success: false, message: 'Repository not found or not accessible.' });
    }

    const verdict = a.response;
    const installedMajor = majorVersion(a.current_version);
    const fixedMajor = majorVersion(a.fixed_version);
    const [ranked] = rankFindings([
      {
        severity: a.severity,
        reachability: verdict.reachability,
        isDirect: a.is_direct,
        fixPublished: Boolean(a.fixed_version),
        majorVersionsBehind:
          installedMajor !== null && fixedMajor !== null ? Math.max(0, fixedMajor - installedMajor) : null,
        callSiteCount: a.evidence?.call_sites?.length ?? null,
        blastRadiusCount: 1
      }
    ]);

    const draft = await ai.draftIssue({
      package_name: a.package_name,
      osv_id: a.osv_id,
      severity: a.severity,
      reachability: verdict.reachability,
      difficulty: ranked.difficulty,
      rank: ranked.rank,
      summary: a.summary,
      reasoning: verdict.reasoning,
      evidence: verdict.evidence || [],
      target_version: verdict.target_version,
      recommendation: verdict.recommendation
    });

    return res.status(200).json({ success: true, data: draft });
  } catch (error) {
    const status = error.status === 503 ? 503 : error.status === 502 ? 502 : 500;
    return res.status(status).json({ success: false, message: 'Issue drafting failed.', error: error.message });
  }
};

module.exports = { extractSurface, assessFinding, draftIssue };
