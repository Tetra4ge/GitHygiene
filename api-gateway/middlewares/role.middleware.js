const { pgPool } = require('../config/db.config');

/**
 * Middleware to restrict route access based on BCNF public users table role check.
 * Admins automatically bypass role restrictions.
 * 
 * @param {string|string[]} allowedRoles Single role string or array of allowed roles.
 */
const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      // Supabase decoded user JWT ID sits in decoded.sub or user_id
      const userId = req.user.sub || req.user.user_id;
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Access Denied: Missing user identifier in token.' 
        });
      }

      // Query role via raw SQL parameterized input to satisfy DBMS safety constraints
      const result = await pgPool.query(
        'SELECT role FROM users WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'User identity not found in database public schema.' 
        });
      }

      const userRole = result.rows[0].role;

      // Admins have super-user privileges across all operations
      if (userRole === 'admin') {
        return next();
      }

      // Check if user's role is within allowed roles
      const isAllowed = Array.isArray(allowedRoles)
        ? allowedRoles.includes(userRole)
        : userRole === allowedRoles;

      if (!isAllowed) {
        return res.status(403).json({ 
          success: false, 
          message: 'Forbidden: Insufficient role permissions.' 
        });
      }

      next();
    } catch (error) {
      console.error('RBAC Middleware Error:', error.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Internal server error validating authorization role.' 
      });
    }
  };
};

module.exports = { requireRole };
