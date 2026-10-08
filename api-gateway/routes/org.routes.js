const express = require('express');
const router = express.Router();
const { createOrg, getOrgs } = require('../controllers/org.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

router.post('/', requireAuth, requireRole(['admin', 'manager']), createOrg);
router.get('/', requireAuth, getOrgs);

module.exports = router;
