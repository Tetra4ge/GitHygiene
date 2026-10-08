const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const graph = require('../services/graph.service');

/** Resolves the organization scope for the caller — admins pass null (every org visible via explicit org param, otherwise their own query still needs an orgId so we require one for admins too). */
async function resolveOrgId(userId, requestedOrgId) {
  const caller = await getCallerContext(userId);
  if (!caller) return null;
  if (caller.role === 'admin' && requestedOrgId) return requestedOrgId;
  return caller.organization_id;
}

function neo4jUnavailable(res, err) {
  console.error('Neo4j query failed:', err.message);
  return res.status(503).json({
    success: false,
    message: 'The dependency graph is temporarily unavailable. Scanning and scoring are unaffected.',
    error: err.message
  });
}

const getBlastRadius = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { vulnId } = req.params;

  try {
    const organizationId = await resolveOrgId(userId, req.query.org_id);
    if (!organizationId) {
      return res.status(200).json({ success: true, data: [] });
    }
    const data = await graph.getBlastRadius(organizationId, vulnId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return neo4jUnavailable(res, error);
  }
};

const getShared = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  try {
    const organizationId = await resolveOrgId(userId, req.query.org_id);
    if (!organizationId) return res.status(200).json({ success: true, data: [] });
    const data = await graph.getSharedDependencies(organizationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return neo4jUnavailable(res, error);
  }
};

const getTopPackages = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  try {
    const organizationId = await resolveOrgId(userId, req.query.org_id);
    if (!organizationId) return res.status(200).json({ success: true, data: [] });
    const data = await graph.getTopPackages(organizationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return neo4jUnavailable(res, error);
  }
};

const getRepoGraph = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { id } = req.params;

  try {
    const caller = await getCallerContext(userId);
    const access = caller?.role === 'admin'
      ? await pgPool.query(
          `SELECT p.organization_id FROM repositories r JOIN projects p ON r.project_id = p.project_id WHERE r.repository_id = $1`,
          [id]
        )
      : await pgPool.query(
          `SELECT p.organization_id
           FROM repositories r
           JOIN projects p ON r.project_id = p.project_id
           JOIN users u ON p.organization_id = u.organization_id
           WHERE r.repository_id = $1 AND u.user_id = $2`,
          [id, userId]
        );
    if (access.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Repository not found or not accessible.' });
    }

    const data = await graph.getRepoGraph(access.rows[0].organization_id, id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return neo4jUnavailable(res, error);
  }
};

module.exports = { getBlastRadius, getShared, getTopPackages, getRepoGraph };
