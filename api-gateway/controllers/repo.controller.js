const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');

/**
 * Controller to synchronize GitHub repository lists within a secure SQL transaction.
 * Uses transactions for atomicity (rollback on failure) and upserts (ON CONFLICT) for idempotent syncing.
 */
const syncRepositories = async (req, res) => {
  const { org_id, project_name, repos } = req.body;
  const userId = req.user.sub || req.user.user_id;

  if (!org_id || !project_name || !Array.isArray(repos)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required parameters: org_id, project_name, or repos array.' 
    });
  }

  const client = await pgPool.connect();

  try {
    // Start transactional block to guarantee ACID properties
    await client.query('BEGIN');

    // 1. Resolve Project ID (Insert if not exists, or fetch existing)
    let projectId;
    const projectCheck = await client.query(
      'SELECT project_id FROM projects WHERE organization_id = $1 AND project_name = $2',
      [org_id, project_name]
    );

    if (projectCheck.rows.length > 0) {
      projectId = projectCheck.rows[0].project_id;
    } else {
      const projectInsert = await client.query(
        `INSERT INTO projects (organization_id, project_name, created_by)
         VALUES ($1, $2, $3)
         RETURNING project_id`,
        [org_id, project_name, userId]
      );
      projectId = projectInsert.rows[0].project_id;
    }

    // 2. Insert/Upsert Repositories
    const syncedRepos = [];
    for (const repo of repos) {
      // Force test error if instructed (used to test transaction rollback)
      if (repo.force_rollback_error) {
        throw new Error('Forced simulation transaction abort error.');
      }

      const repoResult = await client.query(
        `INSERT INTO repositories (project_id, repo_name, default_branch, language, last_synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (project_id, repo_name) DO UPDATE
         SET default_branch = EXCLUDED.default_branch,
             language = EXCLUDED.language,
             last_synced_at = NOW()
         RETURNING *`,
        [projectId, repo.name, repo.default_branch || 'main', repo.language || null]
      );
      syncedRepos.push(repoResult.rows[0]);
    }

    // Commit transaction after all rows succeed
    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Repositories synchronized successfully.',
      data: {
        project_id: projectId,
        repositories: syncedRepos
      }
    });

  } catch (error) {
    // Roll back transaction to prevent orphaned project entries, maintaining referential integrity
    await client.query('ROLLBACK');
    console.error('Repository Sync Transaction Failed:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database transaction failed during sync operation.',
      error: error.message
    });
  } finally {
    // Release client back to pg connection pool
    client.release();
  }
};

/**
 * Controller to fetch repositories. Admins see every repository across every
 * organization on the platform (with the owning org attached so the UI can
 * tell them apart); everyone else sees only their own organization's repos.
 * Fetches repository details with joined scan data.
 */
const getRepositories = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;

  try {
    const caller = await getCallerContext(userId);
    if (!caller) {
      return res.status(404).json({
        success: false,
        message: 'User profile not synchronized in public database schema.'
      });
    }

    if (caller.role === 'admin') {
      const result = await pgPool.query(
        `SELECT r.repository_id, r.repo_name, r.default_branch, r.language, r.last_synced_at,
                p.project_name, o.organization_id, o.organization_name
         FROM repositories r
         JOIN projects p ON r.project_id = p.project_id
         JOIN organizations o ON p.organization_id = o.organization_id
         ORDER BY r.last_synced_at DESC`
      );
      return res.status(200).json({ success: true, data: result.rows });
    }

    const result = await pgPool.query(
      `SELECT r.repository_id, r.repo_name, r.default_branch, r.language, r.last_synced_at,
              p.project_name, o.organization_id, o.organization_name
       FROM repositories r
       JOIN projects p ON r.project_id = p.project_id
       JOIN organizations o ON p.organization_id = o.organization_id
       JOIN users u ON p.organization_id = u.organization_id
       WHERE u.user_id = $1
       ORDER BY r.last_synced_at DESC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get Repositories Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving repositories.'
    });
  }
};

module.exports = {
  syncRepositories,
  getRepositories
};
