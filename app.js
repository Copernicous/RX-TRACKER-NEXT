// CLI flags -- must be first, before any other require
// Usage:  server.exe --v   OR   server.exe --version
// Prints version info and exits without starting the server.
// Usage:  server.exe --reset-password <username> <newpassword>
// Resets the password for the given user and exits. Works without starting the server.
(function checkCliFlags() {
    var args = process.argv.slice(2);

    // ── --version / --v / -v ──────────────────────────────────────────────────
    if (args.indexOf('--v') !== -1 || args.indexOf('--version') !== -1 || args.indexOf('-v') !== -1) {
        var pkg2   = require('./package.json');
        var IS_PKG = typeof process.pkg !== 'undefined';
        var b      = new Date();
        var p      = function(n) { return String(n).padStart(2,'0'); };
        var bstr   = (b.getMonth()+1)+'/'+p(b.getDate())+'/'+b.getFullYear()+
                     '  '+p(b.getHours())+':'+p(b.getMinutes())+':'+p(b.getSeconds());
        console.log('');
        console.log('  Patient RX System');
        console.log('  Version  : ' + pkg2.version);
        console.log('  Node.js  : ' + process.version);
        console.log('  Platform : ' + process.platform + ' ' + process.arch);
        console.log('  Mode     : ' + (IS_PKG ? 'compiled (server.exe)' : 'node app.js'));
        console.log('  Built At : ' + bstr);
        console.log('');
        process.exit(0);
    }

    // ── --reset-password <username> <newpassword> ─────────────────────────────
    var rpIdx = args.indexOf('--reset-password');
    if (rpIdx !== -1) {
        var rpUser = args[rpIdx + 1];
        var rpPass = args[rpIdx + 2];
        if (!rpUser || !rpPass) {
            console.error('\n  Usage: server.exe --reset-password <username> <newpassword>\n');
            process.exit(1);
        }
        // Load .env then reset the password
        // Respect an environment already prepared by a launcher (for example
        // scripts/start-staging.js). Re-reading .env with override=true here
        // could silently point a staging command at the production database.
        require('dotenv').config();
        var bcryptRp = require('bcryptjs');
        var dbRp     = require('./models');
        dbRp.sequelize.authenticate().then(async function() {
            var user = await dbRp.User.findOne({ where: { username: rpUser } });
            if (!user) {
                console.error('\n  ERROR: User "' + rpUser + '" not found.\n');
                process.exit(1);
            }
            var hash = await bcryptRp.hash(rpPass, 12);
            await user.update({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null });
            console.log('\n  ✓ Password for "' + rpUser + '" has been reset successfully.\n');
            process.exit(0);
        }).catch(function(err) {
            console.error('\n  ERROR: ' + err.message + '\n');
            process.exit(1);
        });
        return; // don't continue starting the server
    }
})();


// Launcher-provided variables must win over root .env values. In particular,
// start-staging.js loads and validates .env.staging before requiring this file.
// dotenv's default non-overriding behavior preserves that validated isolation.
require('dotenv').config();

function assertPreparedLauncherEnvironment() {
    const profile = String(process.env.RX_ENV_PROFILE || '').trim().toLowerCase();
    if (!profile) return;

    const mismatches = [];
    const expectedPort = String(process.env.RX_EXPECTED_PORT || '');
    const expectedDb = String(process.env.RX_EXPECTED_DB_NAME || '');
    const expectedRoot = String(process.env.RX_EXPECTED_WRITABLE_ROOT || '');

    if (expectedPort && String(process.env.PORT || '') !== expectedPort) {
        mismatches.push('PORT expected ' + expectedPort + ' but resolved ' + String(process.env.PORT || '(unset)'));
    }
    if (expectedDb && String(process.env.DB_NAME || '') !== expectedDb) {
        mismatches.push('DB_NAME expected ' + expectedDb + ' but resolved ' + String(process.env.DB_NAME || '(unset)'));
    }
    if (expectedRoot && String(process.env.APP_WRITABLE_ROOT || '') !== expectedRoot) {
        mismatches.push('APP_WRITABLE_ROOT changed after the launcher safety check');
    }
    if (profile === 'staging' && !/(staging|stage|qa|test|sandbox|copy)/i.test(String(process.env.DB_NAME || ''))) {
        mismatches.push('staging launcher resolved a non-staging database name');
    }
    if (profile === 'qa' && !/(qa|test|staging|sandbox|codex)/i.test(String(process.env.DB_NAME || ''))) {
        mismatches.push('QA launcher resolved a non-QA database name');
    }

    if (mismatches.length) {
        throw new Error('[ENV ISOLATION] Refusing to start ' + profile + ': ' + mismatches.join('; '));
    }
}

assertPreparedLauncherEnvironment();

// -- Log file setup (LOG_FILE=true in .env enables file logging) ----------------
var _logStream = null;    // Morgan HTTP access log stream
var _errStream = null;    // Error log stream
(function setupLogFiles() {
    if (process.env.LOG_FILE !== 'true') return;
    var fs   = require('fs');
    var path2 = require('path');
    var runtimePaths = require('./utils/runtimePaths');
    // Resolve log directory: next to server.exe by default, or APP_WRITABLE_ROOT for staging/test copies.
    var baseDir = runtimePaths.getWritableRoot();
    var logDir  = path2.join(baseDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    // Delete log files older than LOG_RETENTION_DAYS (default 7)
    var retainDays = parseInt(process.env.LOG_RETENTION_DAYS || '7', 10);
    var cutoff = Date.now() - retainDays * 86400000;
    fs.readdirSync(logDir).forEach(function(f) {
        if (!/\.(log)$/.test(f)) return;
        var fp = path2.join(logDir, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch(e) {}
    });
    // Today's date stamp for file names
    var d   = new Date();
    var pad = function(n) { return String(n).padStart(2,'0'); };
    var stamp = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    // Open append streams for today
    _logStream = fs.createWriteStream(path2.join(logDir, 'access-' + stamp + '.log'), { flags: 'a' });
    _errStream = fs.createWriteStream(path2.join(logDir, 'error-'  + stamp + '.log'), { flags: 'a' });
    // Patch console.error so errors also go to file
    var _origErr = console.error.bind(console);
    console.error = function() {
        var line = '[' + new Date().toISOString() + '] ' + Array.from(arguments).join(' ') + '\n';
        if (_errStream) _errStream.write(line);
        _origErr.apply(console, arguments);
    };
    console.log('[Log] File logging ON -- ' + logDir + '  (retain ' + retainDays + ' days)');
})();
// -------------------------------------------------------------------------------


// -- Crash prevention -- keep server alive on unhandled async errors ------------
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
const crypto      = require('crypto');
const db          = require('./models');
const packageInfo = require('./package.json');
const requestSecurity = require('./utils/requestSecurity');
const { assertDatabaseReady } = require('./db/schema-verifier');

// Start backup scheduler on boot
require('./services/backupService');

// Daily metrics snapshot scheduler -- captures at 00:05 every night
const cron = require('node-cron');
const { captureSnapshot } = require('./services/snapshotService');
cron.schedule('5 0 * * *', async () => {
    console.log('[Cron] Running daily metrics snapshot...');
    try { await captureSnapshot(); }
    catch (e) { console.error('[Cron] Snapshot failed:', e.message); }
}, { timezone: process.env.TZ || 'America/New_York' });

// Settings service -- load system config (timezone, etc.) from DB
const settingsService = require('./services/settingsService');

const app = express();

// [LOCK] Trust proxy -- 1st hop only (FortiGate). Prevents IP spoofing via forged X-Forwarded-For [LOCK]
app.set('trust proxy', 1);

const ENABLE_STRICT_HTTPS_HEADERS = process.env.FORCE_HTTPS === 'true'
    && process.env.HTTPS_ALLOW_LOCAL_HTTP !== 'true'
    && process.env.ENABLE_HSTS !== 'false';
const ALLOW_LEGACY_INLINE_ATTRS = process.env.CSP_ALLOW_INLINE_ATTRS !== 'false';

function cspNonceDirective(req, res) {
    return "'nonce-" + res.locals.cspNonce + "'";
}

function isSecureRequest(req) {
    return requestSecurity.isSecureRequest(req);
}

app.use(function(req, res, next) {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64url');
    next();
});

// -- HTTPS redirect (enable with FORCE_HTTPS=true in .env) --------------------
if (process.env.FORCE_HTTPS === 'true') {
    app.use((req, res, next) => {
        if (isSecureRequest(req) || requestSecurity.shouldAllowLocalHttp(req) || requestSecurity.shouldAllowBackendHttp(req)) return next();
        return res.redirect(301, 'https://' + req.headers.host + req.url);
    });
}

// -- Security headers (Helmet) -------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,  // Prevent Helmet adding upgrade-insecure-requests by default
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", cspNonceDirective],   // Inline script blocks must carry this request nonce.
            scriptSrcAttr:  ALLOW_LEGACY_INLINE_ATTRS ? ["'unsafe-inline'"] : ["'none'"], // Compatibility for legacy onclick/onchange handlers.
            styleSrc:       ["'self'", cspNonceDirective],   // Inline style blocks must carry this request nonce.
            styleSrcAttr:   ALLOW_LEGACY_INLINE_ATTRS ? ["'unsafe-inline'"] : ["'none'"], // Compatibility for existing style="" attributes.
            fontSrc:        ["'self'", 'data:'],              // allow inline/base64-encoded fonts
            workerSrc:      ["'self'", 'blob:'],              // allow blob workers
            imgSrc:         ["'self'", 'data:', 'blob:'],
            connectSrc:     ["'self'", 'https://api.ipify.org', 'https://dns.google'],
            frameSrc:       ["'none'"],
            objectSrc:      ["'none'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
            frameAncestors: ["'self'"],
            // upgradeInsecureRequests intentionally omitted -- only add when HTTPS is configured
            ...(ENABLE_STRICT_HTTPS_HEADERS ? { upgradeInsecureRequests: [] } : {})
        }
    },
    crossOriginOpenerPolicy: false,
    hsts: ENABLE_STRICT_HTTPS_HEADERS
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    crossOriginEmbedderPolicy: false // Allow CDN assets
}));

// -- Rate limiting -- brute-force protection on auth endpoints ------------------
const loginLimiter = rateLimit({
    windowMs:         15 * 60 * 1000,  // 15 minutes
    max:              15,               // max 15 login attempts per IP per window
    standardHeaders:  true,
    legacyHeaders:    false,
    message:          { message: 'Too many login attempts. Please try again in 15 minutes.' },
    skipSuccessfulRequests: true        // only count failures toward the limit
});

// Trust FortiGate SSL VPN and reverse proxy chain -- allows Express to correctly read
// X-Forwarded-For (real client IP) and X-Forwarded-Proto (https) headers.

// SEC-01: CORS - locked to explicit origin allowlist.
// APP_ORIGIN and APP_ORIGINS support comma-separated values for multi-origin setups.
// Example .env:
// APP_ORIGINS=http://localhost:3050,http://127.0.0.1:3050,http://192.168.15.12:3050
(function() {
    function normalizeOrigin(value) {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    function parseOrigins(value) {
        return String(value || '')
            .split(/[,\s]+/)
            .map(normalizeOrigin)
            .filter(Boolean);
    }

    const allowed = Array.from(new Set(
        []
            .concat(parseOrigins(process.env.APP_ORIGIN))
            .concat(parseOrigins(process.env.APP_ORIGINS))
            .concat(parseOrigins(process.env.CORS_ORIGINS))
            .concat(parseOrigins(process.env.ALLOWED_ORIGINS))
    ));
    let corsOrigin;
    if (allowed.length) {
        corsOrigin = function(origin, callback) {
            // Allow same-origin / server-to-server requests (no Origin header)
            if (!origin) return callback(null, true);
            if (allowed.indexOf(normalizeOrigin(origin)) !== -1) return callback(null, true);
            callback(new Error('CORS: origin not allowed - ' + origin + '. Add this URL to APP_ORIGINS in .env.'));
        };
        console.log('[CORS] Allowed origins: ' + allowed.join(', '));
    } else if (process.env.NODE_ENV === 'production') {
        // SEC-04: Fail CLOSED in production - never open credentialed CORS without explicit origin.
        console.error('');
        console.error('===========================================================');
        console.error('  FATAL: APP_ORIGIN/APP_ORIGINS is not set in production mode.');
        console.error('  Refusing to start with open CORS (origin: true).');
        console.error('  Set APP_ORIGINS in .env, e.g.:');
        console.error('    APP_ORIGINS=https://rx.camperos.net:10443,http://192.168.15.12:3050');
        console.error('===========================================================');
        console.error('');
        process.exit(1);
    } else {
        // Development / test - warn but allow open (local dev convenience)
        console.warn('[WARN] APP_ORIGIN/APP_ORIGINS not set - CORS is open (development mode only).');
        corsOrigin = true;
    }
    app.use(cors({ origin: corsOrigin, credentials: true }));
})();
// HTTP access logging: debug mode uses verbose 'dev' format; file stream used when LOG_FILE=true
var _morganFmt = process.env.DEBUG === 'true' ? 'dev' : (process.env.NODE_ENV === 'production' ? 'combined' : 'dev');
if (_logStream) {
    // Write to BOTH console AND file
    app.use(morgan(_morganFmt, { stream: _logStream }));
    app.use(morgan(_morganFmt));
} else {
    app.use(morgan(_morganFmt));
}
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Cache-bust token: changes on every server restart
// EJS templates use this so FortiGate's cached pages redirect to uncached versioned URLs
const APP_BUILD = Date.now();

// Set EJS as templating engine
// IMPORTANT: use app.engine() with an explicit static require() so @yao-pkg/pkg
// can see 'ejs' as a string literal at compile time and bundle it into server.exe.
// app.set('view engine','ejs') alone causes a dynamic require(ext) which pkg
// cannot analyze — resulting in "Cannot find module 'ejs'" at runtime.
const ejs = require('ejs');
app.engine('ejs', ejs.renderFile);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Disable EJS view cache even in production
app.set('view cache', false);

function getAppEnvironment() {
    return String(process.env.APP_ENV || process.env.APP_INSTANCE || process.env.NODE_ENV || '').trim();
}

function isStagingEnvironment() {
    const markers = [
        process.env.APP_ENV,
        process.env.APP_INSTANCE,
        process.env.DB_NAME,
        process.env.APP_WRITABLE_ROOT
    ].filter(Boolean).join(' ');
    return /\bstaging\b|\bstage\b/i.test(markers);
}

function getStagingConfirmHeader() {
    const candidate = String(process.env.STAGING_CONFIRM_HEADER || 'x-staging-confirm').trim().toLowerCase();
    return /^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(candidate) ? candidate : 'x-staging-confirm';
}

function addCspNonceToHtml(html, nonce) {
    if (!nonce || typeof html !== 'string') return html;
    const attr = ' nonce="' + String(nonce).replace(/"/g, '') + '"';
    return html
        .replace(/<script(?![^>]*\bnonce=)(?![^>]*\bsrc=)([^>]*)>/gi, '<script' + attr + '$1>')
        .replace(/<style(?![^>]*\bnonce=)([^>]*)>/gi, '<style' + attr + '$1>');
}

// Legacy draft only. Do not inject this generated inline script into responses:
// FortiGate aggressively rewrites inline JavaScript, and proxy URL resolution now
// lives in the external public/js/base.js file where it can be syntax-checked.
function addProxyBootstrapToHtml(html) {
    if (!html || typeof html !== 'string') return html;
    if (html.indexOf('id="rx-proxy-bootstrap"') !== -1) return html;
    if (html.indexOf('<head') === -1) return html;

    const script = [
        '<script id="rx-proxy-bootstrap">',
        '(function () {',
        '    function splitPath(pathname) {',
        '        return String(pathname || "").split("/").filter(function(part) { return !!part; });',
        '    }',
        '',
        '    function cleanProxyPath(pathname) {',
        '        return String(pathname || "").replace(/[?#].*$/, "");',
        '    }',
        '',
        '    function parseProxyBaseFromPath(pathname) {',
        '        var parts = splitPath(cleanProxyPath(pathname));',
        '        var i = -1;',
        '        for (var j = 0; j < parts.length; j++) {',
        '            if (parts[j] === "proxy") { i = j; break; }',
        '        }',
        '        if (i === -1) return "";',
        '        if (parts.length <= i + 3) return "";',
        '        return window.location.origin + "/proxy/" + parts[i + 1] + "/" + parts[i + 2] + "/" + parts[i + 3];',
        '    }',
        '',
        '    function normalizeAnchorBase(raw) {',
        '        return cleanProxyPath(raw)',
        '            .replace(/\\/login\\/?$/, "")',
        '            .replace(/\\/$/, "");',
        '    }',
        '',
        '    function parseBaseFromAnchor() {',
        '        var baseAnchor = document.getElementById("xa-base");',
        '        if (!baseAnchor || !baseAnchor.href) return "";',
        '        return normalizeAnchorBase(baseAnchor.href);',
        '    }',
        '',
        '    function isAbsolute(url) {',
        '        return /^https?:\\/\\//i.test(url) || /^mailto:|^tel:|^data:|^#/.test(url);',
        '    }',
        '',
        '    function resolveAppBase() {',
        '        var fromPath = parseProxyBaseFromPath(window.location.pathname || "");',
        '        if (fromPath) return fromPath;',
        '        var fromAnchor = parseBaseFromAnchor();',
        '        if (fromAnchor && /^https?:\\/\\//i.test(fromAnchor)) return fromAnchor;',
        '        return window.location.origin;',
        '    }',
        '',
        '    var appBase = resolveAppBase() || window.location.origin;',
        '    window.RX_BASE = appBase;',
        '    window.RX_PROXY_BASE = appBase;',
        '',
        '    function toProxyUrl(value) {',
        '        if (!value || typeof value !== "string") return value;',
        '        if (value.indexOf("//") === 0) return value;',
        '        if (isAbsolute(value)) return value;',
        '        if (value[0] !== "/") return value;',
        '        return appBase + value;',
        '    }',
        '',
        '    if (typeof window.rxUrl !== "function") {',
        '        window.rxUrl = function (path) {',
        '            return toProxyUrl(String(path || ""));',
        '        };',
        '    }',
        '',
        '    if (typeof window.rxNav !== "function") {',
        '        window.rxNav = function (path) {',
        '            window.location.href = toProxyUrl(path || "/");',
        '        };',
        '    }',
        '',
        '    function rewriteNodeAttribute(el, name) {',
        '        if (!el || !el.getAttribute) return;',
        '        var value = el.getAttribute(name);',
        '        if (!value || value[0] !== "/") return;',
        '        el.setAttribute(name, toProxyUrl(value));',
        '    }',
        '',
        '    function rewriteSrcset(element) {',
        '        var value = element.getAttribute("srcset");',
        '        if (!value) return;',
        '        var parts = value.split(",");',
        '        for (var i = 0; i < parts.length; i++) {',
        '            var chunk = parts[i].trim();',
        '            if (!chunk) continue;',
        '            var fields = chunk.split(/\\s+/);',
        '            var path = fields[0] || "";',
        '            if (path[0] === "/") fields[0] = toProxyUrl(path);',
        '            parts[i] = fields.join(" ");',
        '        }',
        '        element.setAttribute("srcset", parts.join(", "));',
        '    }',
        '',
        '    function rewriteStyleText(text) {',
        '        if (!text || text.indexOf("url(") === -1) return text;',
        '        return text.replace(/url\\(\\s*(["\\\'])?(\\/[^\\s"\\\']+)\\1?\\s*\\)/g, function (m, quote, src) {',
        '            if (!src || src[0] !== "/") return m;',
        '            return "url(\\"" + toProxyUrl(src) + "\\")";',
        '        });',
        '    }',
        '',
        '    function rewriteNode(node) {',
        '        if (!node || !node.tagName) return;',
        '        rewriteNodeAttribute(node, "href");',
        '        rewriteNodeAttribute(node, "src");',
        '        rewriteNodeAttribute(node, "action");',
        '        rewriteNodeAttribute(node, "poster");',
        '        rewriteNodeAttribute(node, "data");',
        '        if (node.tagName === "STYLE") {',
        '            node.textContent = rewriteStyleText(String(node.textContent || ""));',
        '        }',
        '        if (node.getAttribute("srcset")) rewriteSrcset(node);',
        '    }',
        '',
        '    function rewriteDocument(target) {',
        '        var root = target || document;',
        '        var nodes = root.querySelectorAll("[href^=\"/\"], [src^=\"/\"], [action^=\"/\"], [poster^=\"/\"], [data^=\"/\"], form[action^=\"/\"], style, [srcset], link[href^=\"/\"]");',
        '        for (var i = 0; i < nodes.length; i++) rewriteNode(nodes[i]);',
        '    }',
        '',
        '    rewriteDocument();',
        '',
        '    function refreshBaseFromAnchor() {',
        '        var next = resolveAppBase();',
        '        if (!next || next === appBase) return;',
        '        appBase = next;',
        '        window.RX_BASE = appBase;',
        '        window.RX_PROXY_BASE = appBase;',
        '        rewriteDocument();',
        '    }',
        '',
        '    if (document.readyState === "loading") {',
        '        document.addEventListener("DOMContentLoaded", function () {',
        '            refreshBaseFromAnchor();',
        '        }, { once: true });',
        '    } else {',
        '        refreshBaseFromAnchor();',
        '    }',
        '',
        '    if (window.MutationObserver) {',
        '        var observer = new MutationObserver(function(records) {',
        '            for (var i = 0; i < records.length; i++) {',
        '                var rec = records[i];',
        '                if (rec.type !== "childList") continue;',
        '                var nodes = rec.addedNodes || [];',
        '                for (var n = 0; n < nodes.length; n++) rewriteDocument(nodes[n].nodeType === 1 ? nodes[n] : null);',
        '            }',
        '        });',
        '        observer.observe(document.documentElement || document, { childList: true, subtree: true });',
        '    }',
        '})();',
        '</script>'
    ].join("\n");

    return html.replace(/<head([^>]*)>/i, '$&' + script);
}

// Expose build/version/environment info to all EJS templates
app.use(function(req, res, next) {
    res.locals.appBuild = APP_BUILD;
    res.locals.appVersion = packageInfo.version;
    res.locals.appEnvironment = getAppEnvironment();
    res.locals.isStaging = isStagingEnvironment();
    res.locals.stagingDestructiveGuard = res.locals.isStaging
        && String(process.env.STAGING_DESTRUCTIVE_GUARD || '').trim().toLowerCase() === 'true';
    res.locals.stagingConfirmHeader = getStagingConfirmHeader();
    res.locals.serviceWindowDays = require('./utils/globalSettings').getServiceWindowDays();
    res.locals.callCenterLeadDays = require('./utils/globalSettings').getCallCenterLeadDays();
    next();
});

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


// Force UTF-8 charset on all HTML responses -- required for FortiGate SSL web access
// and any reverse proxy that rewrites HTML (prevents a" garbled characters)
app.use((req, res, next) => {
    res.render = ((origRender) => function(view, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = undefined;
        }
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        return origRender.call(this, view, options, function(err, html) {
            if (err) {
                if (callback) return callback(err);
                return next(err);
            }
            const rendered = addCspNonceToHtml(html, res.locals.cspNonce);
            if (callback) return callback(null, rendered);
            return res.send(rendered);
        });
    })(res.render);
    next();
});

// Prevent FortiGate SSL VPN from caching or TRANSFORMING responses.
// RFC 7234: 'no-transform' tells proxies not to modify the response body --
// specifically targets FortiGate's behavior of injecting REWRITE() wrappers
// around URL strings in JavaScript, which breaks JS syntax.
// 'no-store' prevents FortiGate from caching and serving stale HTML pages.
app.use(function(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

function parseCookieHeader(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(function(pair) {
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const key = pair.slice(0, idx).trim();
        const raw = pair.slice(idx + 1).trim();
        try {
            cookies[key] = decodeURIComponent(raw);
        } catch (e) {
            cookies[key] = raw;
        }
    });
    return cookies;
}

function csrfCookieOptions(req) {
    const secure = requestSecurity.shouldTreatAsSecure(req);
    return {
        httpOnly: false,
        path: '/',
        sameSite: secure ? 'none' : 'lax',
        secure: requestSecurity.shouldUseSecureCookie(req)
    };
}

function csrfTokenFromAuthCookie(authToken) {
    if (!authToken) return '';
    const secret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
    if (!secret) return '';
    return crypto
        .createHmac('sha256', String(secret))
        .update('rx-csrf-v1:')
        .update(String(authToken))
        .digest('base64url');
}

function csrfSafeEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function shouldSkipCsrf(req) {
    const pathOnly = String(req.path || '').split('?')[0];
    return pathOnly === '/api/auth/login'
        || pathOnly === '/api/auth/login/2fa'
        // These actions are already protected by the current TOTP code. Keeping
        // CSRF on them breaks FortiGate proxy users when the portal rewrites or
        // drops CSRF transport details between QR setup and confirmation.
        || pathOnly === '/api/auth/2fa/enable'
        || pathOnly === '/api/auth/2fa/disable'
        || pathOnly === '/api/auth/2fa/regenerate-backup-codes';
}

// CSRF protection for cookie-authenticated unsafe requests.
app.use(function(req, res, next) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const signedCsrfToken = csrfTokenFromAuthCookie(cookies.rxToken);
    let csrfToken = signedCsrfToken || cookies.rxCsrf;
    if (csrfToken && csrfToken !== cookies.rxCsrf) {
        res.cookie('rxCsrf', csrfToken, csrfCookieOptions(req));
    } else if (!csrfToken || csrfToken.length < 24) {
        csrfToken = crypto.randomBytes(32).toString('base64url');
        res.cookie('rxCsrf', csrfToken, csrfCookieOptions(req));
    }
    res.locals.csrfToken = csrfToken;

    const method = String(req.method || 'GET').toUpperCase();
    const safeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (safeMethod || shouldSkipCsrf(req) || !cookies.rxToken) return next();

    const submitted = String(
        req.headers['x-csrf-token'] ||
        req.headers['x-rx-csrf-token'] ||
        req.headers['x-xsrf-token'] ||
        ((req.body && typeof req.body === 'object') ? (req.body._csrf || req.body.csrfToken || '') : '') ||
        (req.query && typeof req.query._csrf === 'string' ? req.query._csrf : '')
    );
    const valid = csrfSafeEqual(submitted, csrfToken)
        || csrfSafeEqual(submitted, signedCsrfToken)
        || csrfSafeEqual(submitted, cookies.rxCsrf);
    if (!valid) {
        return res.status(403).json({ message: 'CSRF validation failed. Refresh the page and try again.' });
    }
    next();
});


// Static assets must not be cached by the FortiGate portal while staging fixes
// are being validated. A stale base.js/app.js pair can submit an obsolete CSRF
// token even though the freshly rendered page contains the current token.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: function(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, no-transform, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));


// Routes (to be added)
const authRoutes         = require('./routes/authRoutes');
const apiRoutes          = require('./routes/apiRoutes');
const importRoutes       = require('./routes/importRoutes');
const webRoutes          = require('./routes/webRoutes');
const webAuth            = require('./middleware/webAuth');
const userActivityLogger = require('./middleware/userActivityLogger');
const twoFactorRoutes    = require('./routes/twoFactorRoutes');

// Tag each sub-router with its mount prefix so routeInspector can read it
authRoutes._mountPrefix        = '/api/auth';
importRoutes._mountPrefix      = '/api/import';
apiRoutes._mountPrefix         = '/api';
webRoutes._mountPrefix         = '/';
twoFactorRoutes._mountPrefix   = '/api/auth';

// -- Extended rate limiting for sensitive endpoints ---------------------------
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
app.use('/api/api-keys',            apiKeyLimiter);  // SEC-05: was '/api/keys' (wrong path — routes are at /api/api-keys)
app.use('/api/settings',            settingsLimiter);

app.use('/api/auth',    authRoutes);
app.use('/api/auth',    twoFactorRoutes);
app.use('/api/import',  importRoutes);
const PORT = process.env.PORT || 3000;
app.get('/api/healthz', async (req, res) => {
    let database = 'ok';
    try { await db.sequelize.authenticate(); } catch { database = 'unreachable'; }
    res.status(database === 'ok' ? 200 : 503).json({
        status: database === 'ok' ? 'ok' : 'degraded',
        project: 'RX-TRACKER', version: require('./package.json').version,
        pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000),
        database, httpPort: Number(PORT)
    });
});
app.use('/api',         apiRoutes);
app.use('/',            webAuth, userActivityLogger, webRoutes);   // webAuth decodes rxToken cookie -> res.locals.userPerms




// Error handling middleware -- logs to ErrorLog table
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


// Normal web-server startup is intentionally read-only with respect to database
// structure and reference data. Creation, adoption, migration, and seeding are
// explicit rx-db lifecycle operations.
const startServer = async () => {
    try {
        const report = await assertDatabaseReady(db);
        console.log(
            `[DB] Schema ready: ${report.migrations.applied.length} migration(s) applied; no pending migrations.`
        );
    } catch (error) {
        console.error('[DB] STARTUP BLOCKED:', error.message);
        if (error.report && error.report.migrations && error.report.migrations.pending.length) {
            error.report.migrations.pending.slice(0, 10).forEach((name) => {
                console.error('[DB]   PENDING ' + name);
            });
        }
        await db.sequelize.close().catch(() => {});
        process.exit(1);
        return;
    }

    // Load system settings only after the schema has passed read-only validation.
    await settingsService.load();

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}.`);
    });
};

startServer();
module.exports = app;
