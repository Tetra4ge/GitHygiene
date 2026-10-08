const { pgPool } = require('../config/db.config');

// Self-healing schema migrations, following the pattern already established
// by parser.controller.js — idempotent IF NOT EXISTS statements run on
// demand rather than a separate migration step a clean clone would forget.
// Shared here so every controller that reads or writes these columns/tables
// (osv.controller, repo.controller) runs the same migration instead of each
// re-declaring its own copy.
let ensured = false;

async function ensureOsvSchema() {
  if (ensured) return;

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS osv_vulnerabilities (
      osv_id VARCHAR(100) PRIMARY KEY,
      aliases TEXT[],
      severity VARCHAR(20),
      summary TEXT,
      details TEXT,
      raw JSONB,
      cached_at TIMESTAMP DEFAULT now()
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS osv_findings (
      finding_id SERIAL PRIMARY KEY,
      repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
      dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
      osv_id VARCHAR(100) NOT NULL REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
      fixed_version VARCHAR(100),
      status VARCHAR(20) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT now(),
      UNIQUE (dependency_id, osv_id)
    )
  `);
  await pgPool.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS security_score INT');
  await pgPool.query("ALTER TABLE repositories ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20)");
  await pgPool.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS score_breakdown JSONB');
  await pgPool.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMP');
  await pgPool.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_scan_error TEXT');
  await pgPool.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS graph_error TEXT');

  ensured = true;
}

module.exports = { ensureOsvSchema };
