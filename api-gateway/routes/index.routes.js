const express = require('express');
const router = express.Router();

const orgRoutes = require('./org.routes');
const userRoutes = require('./user.routes');
const repoRoutes = require('./repo.routes');
const githubRoutes = require('./github.routes');
const manifestRoutes = require('./manifest.routes');
const parserRoutes = require('./parser.routes');
const scannerRoutes = require('./scanner.routes');
const osvRoutes = require('./osv.routes');

// Mount routes under api-gateway namespace
router.use('/orgs', orgRoutes);
router.use('/users', userRoutes);
router.use('/repos', repoRoutes);
router.use('/github', githubRoutes);
router.use('/manifests', manifestRoutes);
router.use('/parser', parserRoutes);
router.use('/scanner', scannerRoutes);
router.use('/osv', osvRoutes);

module.exports = router;
