const express = require('express');
const router = express.Router();
const { runOsvScan, getFindings } = require('../controllers/osv.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/scan', requireAuth, runOsvScan);
router.get('/findings', requireAuth, getFindings);

module.exports = router;
