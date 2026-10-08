const express = require('express');
const router = express.Router();
const { getCurrentUser, listOrgUsers, updateUserRole } = require('../controllers/user.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

router.get('/me', requireAuth, getCurrentUser);
router.get('/', requireAuth, requireRole(['admin', 'manager']), listOrgUsers);
router.put('/:userId/role', requireAuth, requireRole(['admin', 'manager']), updateUserRole);

module.exports = router;
