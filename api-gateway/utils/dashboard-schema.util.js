const { pgPool } = require('../config/db.config');

let ensured = false;

async function ensureDashboardSchema() {
  if (ensured) return;

  // Keyed by organization, not user — this platform's hierarchy is
  // organizations -> projects -> repositories (phases/Phase_05.md §6), not
  // the per-user model TRD §5.1 originally assumed.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      repository_id INT REFERENCES repositories(repository_id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT now()
    )
  `);

  ensured = true;
}

async function createNotification({ organizationId, repositoryId, type, title, body }) {
  await ensureDashboardSchema();
  await pgPool.query(
    `INSERT INTO notifications (organization_id, repository_id, type, title, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, repositoryId || null, type, title, body || null]
  );
}

module.exports = { ensureDashboardSchema, createNotification };
