const express = require('express');
const router = express.Router();
const { extractDependencies } = require('../controllers/parser.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Route to parse dependencies from an ingested manifest file
router.post('/extract', requireAuth, extractDependencies);

module.exports = router;
