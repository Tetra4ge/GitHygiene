const { pgPool } = require('../config/db.config');

let ensured = false;

async function ensureAiSchema() {
  if (ensured) return;

  // Stage 1 cache — keyed by advisory id, platform-wide, effectively
  // permanent (AI_DESIGN.md §10). One call per advisory ever, shared by
  // every repository and every user that advisory affects.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS advisory_surfaces (
      osv_id VARCHAR(100) PRIMARY KEY REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
      vulnerable_symbols TEXT[],
      vulnerable_subpaths TEXT[],
      vulnerable_configs TEXT[],
      trigger_conditions TEXT[],
      attack_vector VARCHAR(100),
      needs_untrusted_input BOOLEAN,
      exploit_requires_runtime VARCHAR(20),
      extraction_confidence VARCHAR(10),
      notes TEXT,
      model VARCHAR(100),
      from_ecosystem_specific BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT now()
    )
  `);

  // Stage 3 cache — keyed by (advisory, repository, dependency version,
  // commit sha). A new commit invalidates it; "Regenerate" bypasses it.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ai_assessments (
      assessment_id SERIAL PRIMARY KEY,
      osv_id VARCHAR(100) NOT NULL REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
      repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
      dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
      installed_version VARCHAR(100) NOT NULL,
      commit_sha VARCHAR(100) NOT NULL,
      model VARCHAR(100),
      response JSONB NOT NULL,
      evidence JSONB,
      remediation JSONB,
      created_at TIMESTAMP DEFAULT now(),
      UNIQUE (osv_id, repository_id, dependency_id, installed_version, commit_sha)
    )
  `);

  ensured = true;
}

module.exports = { ensureAiSchema };
