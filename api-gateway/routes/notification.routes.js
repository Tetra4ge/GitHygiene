const express = require('express');
const router = express.Router();
const { listNotifications, markRead } = require('../controllers/notification.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.get('/', requireAuth, listNotifications);
router.patch('/:id/read', requireAuth, markRead);

module.exports = router;
