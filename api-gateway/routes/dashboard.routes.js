const express = require('express');
const router = express.Router();
const { getSummary } = require('../controllers/dashboard.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.get('/summary', requireAuth, getSummary);

module.exports = router;
