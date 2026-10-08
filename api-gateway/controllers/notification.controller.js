const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const { ensureDashboardSchema } = require('../utils/dashboard-schema.util');

const listNotifications = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;

  try {
    await ensureDashboardSchema();
    const caller = await getCallerContext(userId);
    if (!caller) return res.status(200).json({ success: true, data: [], unreadCount: 0 });

    const params = caller.role === 'admin' ? [] : [caller.organization_id];
    const where = caller.role === 'admin' ? '' : 'WHERE n.organization_id = $1';

    const result = await pgPool.query(
      `SELECT n.*, r.repo_name
       FROM notifications n
       LEFT JOIN repositories r ON n.repository_id = r.repository_id
       ${where}
       ORDER BY n.created_at DESC
       LIMIT 50`,
      params
    );
    const unreadCount = result.rows.filter((n) => !n.is_read).length;

    return res.status(200).json({ success: true, data: result.rows, unreadCount });
  } catch (error) {
    console.error('List Notifications Error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error retrieving notifications.' });
  }
};

const markRead = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { id } = req.params;

  try {
    await ensureDashboardSchema();
    const caller = await getCallerContext(userId);
    const result = caller?.role === 'admin'
      ? await pgPool.query(
          'UPDATE notifications SET is_read = true WHERE notification_id = $1 RETURNING *',
          [id]
        )
      : await pgPool.query(
          'UPDATE notifications SET is_read = true WHERE notification_id = $1 AND organization_id = $2 RETURNING *',
          [id, caller?.organization_id]
        );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found or not accessible.' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Mark Notification Read Error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error updating notification.' });
  }
};

module.exports = { listNotifications, markRead };
