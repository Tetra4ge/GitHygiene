const { pgPool } = require('../config/db.config');

/**
 * Looks up the caller's role and organization from the public `users` table.
 * Every controller that needs to branch behavior on role (plain org-scoped
 * access vs. an admin's platform-wide view) calls this once rather than
 * re-deriving it inline — keeps the "admin sees everything" rule in one place.
 *
 * Returns null if the JWT's subject has no corresponding row yet (e.g. the
 * Supabase signup trigger hasn't synced them into Postgres).
 */
async function getCallerContext(userId) {
  const { rows } = await pgPool.query(
    'SELECT role, organization_id FROM users WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

module.exports = { getCallerContext };
