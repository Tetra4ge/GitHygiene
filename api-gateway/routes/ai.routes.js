const express = require('express');
const router = express.Router();
const { extractSurface, assessFinding } = require('../controllers/ai.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/extract-surface', requireAuth, extractSurface);
router.post('/assess', requireAuth, assessFinding);

module.exports = router;
