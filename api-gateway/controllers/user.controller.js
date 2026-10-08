const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');

/**
 * Controller to fetch the currently authenticated user profile details from Postgres.
 */
const getCurrentUser = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;

  if (!userId) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access Denied: Missing user identifier in token.' 
    });
  }

  try {
    // Left join organization to display the name on onboarding/profile queries
    const result = await pgPool.query(
      `SELECT u.user_id, u.organization_id, u.full_name, u.email, u.role, u.created_at, u.last_login, o.organization_name
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.organization_id
       WHERE u.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'User profile not synchronized in public database schema.' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      data: result.rows[0] 
    });
  } catch (error) {
    console.error('Get Current User Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error retrieving user profile.' 
    });
  }
};

/**
 * Controller listing team members. Admins get every user across every
 * organization on the platform (with their org attached); managers get only
 * their own organization's roster — this route is admin/manager only, so a
 * plain developer never reaches this branch.
 */
const listOrgUsers = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;

  try {
    const callerResult = await pgPool.query('SELECT role, organization_id FROM users WHERE user_id = $1', [userId]);
    if (callerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User profile not synchronized in public database schema.'
      });
    }

    const { role, organization_id: organizationId } = callerResult.rows[0];

    if (role === 'admin') {
      const result = await pgPool.query(
        `SELECT u.user_id, u.full_name, u.email, u.role, u.created_at, u.last_login,
                u.organization_id, o.organization_name
         FROM users u
         LEFT JOIN organizations o ON u.organization_id = o.organization_id
         ORDER BY o.organization_name ASC NULLS LAST, u.created_at ASC`
      );
      return res.status(200).json({ success: true, data: result.rows });
    }

    if (!organizationId) {
      return res.status(200).json({
        success: true,
        message: 'You are not assigned to an organization yet.',
        data: []
      });
    }

    const result = await pgPool.query(
      `SELECT user_id, full_name, email, role, created_at, last_login
       FROM users
       WHERE organization_id = $1
       ORDER BY created_at ASC`,
      [organizationId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('List Org Users Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving organization members.'
    });
  }
};

/**
 * Controller allowing administrators and managers to modify a user's
 * authorization role. Admins can reassign anyone on the platform; managers
 * are confined to their own organization's members (checked below, since the
 * route-level requireRole(['admin','manager']) only confirms *a* privileged
 * role, not which org that privilege extends to).
 */
const updateUserRole = async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  const callerId = req.user.sub || req.user.user_id;

  if (!role || !['admin', 'manager', 'developer'].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Invalid role assignment. Must be 'admin', 'manager', or 'developer'."
    });
  }

  try {
    const caller = await getCallerContext(callerId);
    if (!caller) {
      return res.status(404).json({
        success: false,
        message: 'User profile not synchronized in public database schema.'
      });
    }

    if (caller.role !== 'admin') {
      const target = await pgPool.query('SELECT organization_id FROM users WHERE user_id = $1', [userId]);
      if (target.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Target user identity not found.' });
      }
      if (target.rows[0].organization_id !== caller.organization_id) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: managers can only reassign roles within their own organization.'
        });
      }
    }

    // Update role using parameterized queries
    const result = await pgPool.query(
      `UPDATE users
       SET role = $1
       WHERE user_id = $2
       RETURNING *`,
      [role, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Target user identity not found.' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'User authorization role updated successfully.',
      data: result.rows[0] 
    });
  } catch (error) {
    console.error('Update User Role Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error updating user role.' 
    });
  }
};

module.exports = {
  getCurrentUser,
  listOrgUsers,
  updateUserRole
};
