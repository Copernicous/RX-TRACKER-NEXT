const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// SEC-01 FIX: Rate limit the login endpoint to prevent brute-force attacks
// Allow a maximum of 10 attempts per 15 minutes per IP address
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 10,                     // max 10 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
    },
    // Skip rate limiting for successful requests (only count failures)
    skipSuccessfulRequests: true
});

router.post('/login', loginLimiter, authController.login);
router.get('/profile', auth, authController.getProfile);

module.exports = router;
