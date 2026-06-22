require('dotenv').config();

// ── Crash prevention — keep server alive on unhandled async errors ────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH PREVENTED] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message, err.stack);
});
const express     = require('express');
const cors        = require('cors');
const morgan      = require('morgan');
const bodyParser  = require('body-parser');
const path        = require('path');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const db          = require('./models');

// Start backup scheduler on boot
require('./services/backupService');

// Daily metrics snapshot scheduler — captures at 00:05 every night
const cron = require('node-cron');
const { captureSnapshot } = require('./services/snapshotService');
cron.schedule('5 0 * * *', async () => {
    console.log('[Cron] Running daily metrics snapshot...');
    try { await captureSnapshot(); }
    catch (e) { console.error('[Cron] Snapshot failed:', e.message); }
}, { timezone: process.env.TZ || 'America/New_York' });

// Settings service — load system config (timezone, etc.) from DB
const settingsService = require('./services/settingsService');

const app = express();

// 🔒 Trust proxy — 1st hop only (FortiGate). Prevents IP spoofing via forged X-Forwarded-For 🔒
app.set('trust proxy', 1);

function isSecureRequest(req) {
    if (req.secure) return true;
    const forwardedProto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || '').toLowerCase();
    if (forwardedProto.includes('https')) return true;
    if ((req.headers['front-end-https'] || '').toLowerCase() === 'on') return true;
    if (req.headers['x-arr-ssl']) return true;
    return false;
}

// ── HTTPS redirect (enable with FORCE_HTTPS=true in .env) ────────────────────
if (process.env.FORCE_HTTPS === 'true') {
    app.use((req, res, next) => {
        if (isSecureRequest(req)) return next();
        return res.redirect(301, 'https://' + req.headers.host + req.url);
    });
}

// ── Security headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,  // Prevent Helmet adding upgrade-insecure-requests by default
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'"],   // CDN removed — all JS served locally
            scriptSrcAttr:  ["'unsafe-inline'"],             // Required: app uses inline onclick handlers
            styleSrc:       ["'self'", "'unsafe-inline'"],   // CDN removed — all CSS served locally
            fontSrc:        ["'self'", 'data:'],              // allow inline/base64-encoded fonts
            workerSrc:      ["'self'", 'blob:'],              // allow blob workers
            imgSrc:         ["'self'", 'data:', 'blob:'],
            connectSrc:     ["'self'", 'https://api.ipify.org', 'https://dns.google'],
            frameSrc:       ["'none'"],
            objectSrc:      ["'none'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
            frameAncestors: ["'self'"],
            // upgradeInsecureRequests intentionally omitted — only add when HTTPS is configured
            ...(process.env.FORCE_HTTPS === 'true' ? { upgradeInsecureRequests: [] } : {})
        }
    },
    crossOriginOpenerPolicy: false,
    hsts: process.env.FORCE_HTTPS === 'true'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    crossOriginEmbedderPolicy: false // Allow CDN assets
}));

// ── Rate limiting — brute-force protection on auth endpoints ──────────────────
const loginLimiter = rateLimit({
    windowMs:         15 * 60 * 1000,  // 15 minutes
    max:              15,               // max 15 login attempts per IP per window
    standardHeaders:  true,
    legacyHeaders:    false,
    message:          { message: 'Too many login attempts. Please try again in 15 minutes.' },
    skipSuccessfulRequests: true        // only count failures toward the limit
});

// Trust FortiGate SSL VPN and reverse proxy chain — allows Express to correctly read
// X-Forwarded-For (real client IP) and X-Forwarded-Proto (https) headers.

// Middleware
const corsOrigin = process.env.APP_ORIGIN || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
// CONFIG-01 FIX: Use appropriate Morgan log format per environment
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Cache-bust token: changes on every server restart
// EJS templates use this so FortiGate's cached pages redirect to uncached versioned URLs
const APP_BUILD = Date.now();

// Set EJS as templating engine (we will use simple HTML views with JS, EJS just for layout if needed)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Disable EJS view cache even in production
app.set('view cache', false);

// Expose APP_BUILD to all EJS templates
app.use(function(req, res, next) { res.locals.appBuild = APP_BUILD; next(); });

// Serve a small favicon explicitly to prevent proxy/browser favicon errors.
app.get('/favicon.ico', (req, res) => {
    const favicon = Buffer.from(
        'AAABAAEAEBAAAAAAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'base64'
    );
    res.set('Content-Type', 'image/x-icon');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(favicon);
});


// Force UTF-8 charset on all HTML responses — required for FortiGate SSL web access
// and any reverse proxy that rewrites HTML (prevents â€" garbled characters)
app.use((req, res, next) => {
    const orig = res.setHeader.bind(res);
    res.render = ((origRender) => function(view, options, callback) {
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        return origRender.call(this, view, options, callback);
    })(res.render);
    next();
});

// Prevent FortiGate SSL VPN from caching or TRANSFORMING responses.
// RFC 7234: 'no-transform' tells proxies not to modify the response body —
// specifically targets FortiGate's behavior of injecting REWRITE() wrappers
// around URL strings in JavaScript, which breaks JS syntax.
// 'no-store' prevents FortiGate from caching and serving stale HTML pages.
app.use(function(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});


// Static folder
app.use(express.static(path.join(__dirname, 'public')));


// Routes (to be added)
const authRoutes         = require('./routes/authRoutes');
const apiRoutes          = require('./routes/apiRoutes');
const importRoutes       = require('./routes/importRoutes');
const webRoutes          = require('./routes/webRoutes');
const webAuth            = require('./middleware/webAuth');
const twoFactorRoutes    = require('./routes/twoFactorRoutes');

// Tag each sub-router with its mount prefix so routeInspector can read it
authRoutes._mountPrefix        = '/api/auth';
importRoutes._mountPrefix      = '/api/import';
apiRoutes._mountPrefix         = '/api';
webRoutes._mountPrefix         = '/';
twoFactorRoutes._mountPrefix   = '/api/auth';

// ── Extended rate limiting for sensitive endpoints ───────────────────────────
// API key management: 30 requests / 15 min (prevents key enumeration)
const apiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many API key requests. Please try again later.' }
});
// 2FA setup: 10 requests / 15 min per IP
const twoFaSetupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many 2FA setup attempts. Please try again later.' }
});
// Settings write: 20 changes / 15 min
const settingsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many settings changes. Please try again later.' },
    skipSuccessfulRequests: false
});

// Apply rate limiters to login and sensitive endpoints
app.use('/api/auth/login',          loginLimiter);
app.use('/api/auth/2fa/setup',      twoFaSetupLimiter);
app.use('/api/auth/2fa/enable',     twoFaSetupLimiter);
app.use('/api/keys',                apiKeyLimiter);
app.use('/api/settings',            settingsLimiter);

app.use('/api/auth',    authRoutes);
app.use('/api/auth',    twoFactorRoutes);
app.use('/api/import',  importRoutes);
app.use('/api',         apiRoutes);
app.use('/',            webAuth, webRoutes);   // webAuth decodes rxToken cookie → res.locals.userPerms




// Error handling middleware — logs to ErrorLog table
app.use(async (err, req, res, next) => {
    console.error(err.stack);
    try {
        const errorLogController = require('./controllers/errorLogController');
        await errorLogController.logBackend({
            message:   err.message || 'Internal Server Error',
            stack:     err.stack   || null,
            url:       req.originalUrl,
            userId:    req.user ? req.user.id : null,
            ipAddress: req.ip,
            severity:  'error'
        });
    } catch {}
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        // Automatically ensure permissions column exists in PostgreSQL
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "permissions" TEXT;');
        console.log('Database verified: Users.permissions column ready.');
    } catch (e) {
        console.warn('Startup migration warning (non-fatal):', e.message);
    }

    // Add Return-to-Warehouse columns to RXRecords (safe to run repeatedly)
    try {
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "returnedToWarehouse" BOOLEAN DEFAULT FALSE;');
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "warehouseReturnDate" TIMESTAMP WITH TIME ZONE;');
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "warehouseReturnNote" VARCHAR(255);');
        console.log('Database verified: RXRecords warehouse columns ready.');
    } catch (e) {
        console.warn('Startup migration warning (RXRecords warehouse, non-fatal):', e.message);
    }

    // Ensure previousValue column exists in AuditLogs (for undo/return-to-warehouse tracking)
    try {
        await db.sequelize.query('ALTER TABLE "AuditLogs" ADD COLUMN IF NOT EXISTS "previousValue" JSON;');
        console.log('Database verified: AuditLogs.previousValue column ready.');
    } catch (e) {
        console.warn('Startup migration warning (AuditLogs.previousValue, non-fatal):', e.message);
    }

    // Ensure notes column exists in Users table
    try {
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "notes" TEXT;');
        console.log('Database verified: Users.notes column ready.');
    } catch (e) {
        console.warn('Startup migration warning (Users.notes, non-fatal):', e.message);
    }

    // Ensure sortOrder column exists in MedicationCatalogs table
    try {
        await db.sequelize.query('ALTER TABLE "MedicationCatalogs" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER DEFAULT 999;');
        console.log('Database verified: MedicationCatalogs.sortOrder column ready.');
    } catch (e) {
        console.warn('Startup migration warning (MedicationCatalogs.sortOrder, non-fatal):', e.message);
    }

    // H1 FIX: Ensure patientCode has a DB-level UNIQUE constraint (race-safe duplicate prevention)
    try {
        await db.sequelize.query('ALTER TABLE "Patients" ADD CONSTRAINT "Patients_patientCode_unique" UNIQUE ("patientCode");');
        console.log('Database verified: Patients.patientCode UNIQUE constraint ready.');
    } catch (e) {
        // '42P07' = duplicate_table / constraint already exists — safe to ignore
        if (!e.message.includes('already exists')) {
            console.warn('Startup migration warning (Patients.patientCode unique, non-fatal):', e.message);
        }
    }

    // ─── 2FA & Account Security Migration ────────────────────────────────────
    try {
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT FALSE;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER DEFAULT 0;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "backupCodes" TEXT;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER DEFAULT 0;');
        console.log('Database verified: Users 2FA, lockout, backup codes, and tokenVersion columns ready.');
    } catch (e) {
        console.warn('Startup migration warning (Users 2FA columns, non-fatal):', e.message);
    }

    // Add new columns to Roles table and seed built-in role permissions
    try {
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "permissions" TEXT;');
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "isSystem"    BOOLEAN DEFAULT false;');
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "description" VARCHAR(255);');
        console.log('Database verified: Roles custom columns ready.');

        // Mark the 4 built-in roles as system (non-deletable)
        await db.sequelize.query('UPDATE "Roles" SET "isSystem" = true WHERE name IN (\'Administrator\',\'Supervisor\',\'Operator\',\'Read Only\');');

        // Seed / re-seed permissions for each built-in role.
        // Re-seeds if: (a) no permissions yet, OR (b) canAdd is missing (new field added today)
        const { BUILT_IN_DEFAULTS } = require('./middleware/rbac');
        const builtInRoles = await db.Role.findAll({ where: { isSystem: true } });
        for (const role of builtInRoles) {
            const needsSeed = !role.permissions;
            const needsUpdate = role.permissions && role.permissions.patients !== undefined
                && !Object.prototype.hasOwnProperty.call(role.permissions.patients || {}, 'canAdd');
            if ((needsSeed || needsUpdate) && BUILT_IN_DEFAULTS[role.name]) {
                const perms = BUILT_IN_DEFAULTS[role.name]();
                await role.update({ permissions: perms });
                console.log(`[Roles] ${needsSeed ? 'Seeded' : 'Updated'} permissions for built-in role: ${role.name}`);
            }
        }
        console.log('Database verified: Built-in role permissions seeded.');

    } catch (e) {
        console.warn('Startup migration warning (Roles custom columns, non-fatal):', e.message);
    }

    await db.sequelize.sync();

    // Load system settings (including timezone) BEFORE the server starts accepting requests
    await settingsService.load();

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}.`);
    });
};

startServer();
module.exports = app;
