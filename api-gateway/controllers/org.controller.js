const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');

/**
 * Controller to handle organization creation via raw SQL.
 * REST access restricted to administrators and managers.
 */
const createOrg = async (req, res) => {
  const { org_name, domain, subscription_plan } = req.body;
  const userId = req.user.sub || req.user.user_id;

  if (!org_name) {
    return res.status(400).json({
      success: false,
      message: 'Organization name is required.'
    });
  }

  // Runs as one transaction: creating an org without attaching the creator to it
  // leaves users.organization_id NULL, which silently breaks every downstream
  // query that scopes by organization (GET /repos, GET /manifests, etc. all join
  // through the caller's own organization_id) — so both writes must succeed together.
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const orgResult = await client.query(
      `INSERT INTO organizations (organization_name, domain, subscription_plan)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [org_name, domain || null, subscription_plan || 'free']
    );
    const org = orgResult.rows[0];

    await client.query(
      `UPDATE users SET organization_id = $1 WHERE user_id = $2`,
      [org.organization_id, userId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Organization created successfully.',
      data: org
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create Org Error:', error.message);

    // PostgreSQL error code '23505' represents a UNIQUE violation (e.g. domain uniqueness)
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Organization domain already exists.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error creating organization.'
    });
  } finally {
    client.release();
  }
};

/**
 * Controller to list organizations.
 * Admins see every organization on the platform; everyone else sees only
 * their own (or an empty list if they aren't assigned to one yet).
 */
const getOrgs = async (req, res) => {
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
        'SELECT * FROM organizations ORDER BY created_at DESC'
      );
      return res.status(200).json({
        success: true,
        data: result.rows
      });
    }

    if (!caller.organization_id) {
      return res.status(200).json({ success: true, data: [] });
    }

    const result = await pgPool.query(
      'SELECT * FROM organizations WHERE organization_id = $1',
      [caller.organization_id]
    );
    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get Orgs Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving organizations.'
    });
  }
};

module.exports = {
  createOrg,
  getOrgs
};
