'use strict';
const express    = require('express');
const router     = express.Router();
const tfCtrl     = require('../controllers/twoFactorController');
const auth       = require('../middleware/auth');

// ── 2FA setup / management (requires valid full JWT) ───────────────────────────
router.get ('/2fa/setup',    auth, tfCtrl.setup);
router.post('/2fa/enable',   auth, tfCtrl.enable);
router.post('/2fa/disable',  auth, tfCtrl.disable);
router.get ('/2fa/status',   auth, tfCtrl.status);

// ── 2FA login second step (no auth — uses tempToken from login step 1) ─────────
router.post('/login/2fa',    tfCtrl.verifyLogin);

module.exports = router;
