const express = require('express');
const router = express.Router();
const { ingestManifest } = require('../controllers/manifest.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Route to ingest a repository dependency manifest file
router.post('/ingest', requireAuth, ingestManifest);

module.exports = router;
