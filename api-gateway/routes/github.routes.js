const express = require('express');
const router = express.Router();
const { exchangeGitHubCode, fetchGitHubRepositories } = require('../controllers/github.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// Route to exchange GitHub OAuth code for access token
router.post('/token', requireAuth, exchangeGitHubCode);

// Route to fetch repositories from GitHub using OAuth token
router.get('/repos', requireAuth, fetchGitHubRepositories);

module.exports = router;
