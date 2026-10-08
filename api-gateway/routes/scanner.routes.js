const express = require('express');
const router = express.Router();
const { runSecurityScan, getAlerts, resolveAlert } = require('../controllers/scanner.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/scan', requireAuth, runSecurityScan);
router.get('/alerts', requireAuth, getAlerts);
router.patch('/alerts/:alert_id/resolve', requireAuth, resolveAlert);

module.exports = router;
