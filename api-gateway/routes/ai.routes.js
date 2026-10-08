const express = require('express');
const router = express.Router();
const { extractSurface, assessFinding, draftIssue } = require('../controllers/ai.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/extract-surface', requireAuth, extractSurface);
router.post('/assess', requireAuth, assessFinding);
router.post('/draft-issue', requireAuth, draftIssue);

module.exports = router;
