const express = require('express');
const router = express.Router();

router.use('/health', require('./health'));
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/games', require('./games'));
router.use('/analysis', require('./analysis'));
router.use('/chat', require('./chat'));
router.use('/reports', require('./reports'));
router.use('/subscriptions', require('./subscriptions'));
router.use('/training', require('./training'));
router.use('/voice', require('../voice/routes/voice'));

module.exports = router;
