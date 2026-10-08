const express = require('express');
const router = express.Router();
const { syncRepositories, getRepositories } = require('../controllers/repo.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.post('/sync', requireAuth, syncRepositories);
router.get('/', requireAuth, getRepositories);

module.exports = router;
