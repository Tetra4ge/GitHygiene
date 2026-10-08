const express = require('express');
const router = express.Router();
const { getBlastRadius, getShared, getTopPackages, getRepoGraph } = require('../controllers/graph.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.get('/blast-radius/:vulnId', requireAuth, getBlastRadius);
router.get('/shared', requireAuth, getShared);
router.get('/top-packages', requireAuth, getTopPackages);
router.get('/repo/:id', requireAuth, getRepoGraph);

module.exports = router;
