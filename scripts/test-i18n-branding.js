'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const i18nSource = read('public/js/i18n.js');
const login = read('views/login.ejs');
const sidebar = read('views/partials/sidebar.ejs');
const backoffice = read('views/backoffice.ejs');
const settingsView = read('views/system-settings.ejs');
const settingsClient = read('public/js/system-settings.js');
const settingsService = read('services/settingsService.js');
const settingsController = read('controllers/settingsController.js');
const glossary = read('docs/UI_TRANSLATION_GLOSSARY.md');
const callCenterView = read('views/call-center.ejs');
const callCenterClient = read('public/js/call-center.js');
const appClient = read('public/js/app.js');
const patientsClient = read('public/js/patients.js');
const reportsClient = read('public/js/reports.js');
const crudView = read('views/crud.ejs');
const patientsView = read('views/patients.ejs');
const passengerMinivanIcon = read('public/images/brand-icons/minivan-passengers.svg');
const boardingMinivanIcon = read('public/images/brand-icons/minivan-boarding.svg');

assert(i18nSource.includes("'Patients': 'Pacientes'"), 'Spanish Patients translation is missing');
assert(i18nSource.includes("'Sign In': 'Iniciar sesión'"), 'Spanish login translation is missing');
assert(i18nSource.includes('localStorage.setItem(STORAGE_KEY, lang)'), 'Language preference is not persisted');
assert(i18nSource.includes("parent.closest('tbody td')"), 'Patient/business table protection is missing');
assert(i18nSource.includes('[data-i18n-skip]'), 'Explicit translation exclusion is missing');
assert(i18nSource.includes("'Call Queue': 'Cola de llamadas'"), 'Call Center card translation is missing');
assert(i18nSource.includes("'Efficiency': 'Eficiencia'"), 'Call Center efficiency translation is missing');
assert(i18nSource.includes('translateDynamic'), 'Formatted UI translation support is missing');
assert(i18nSource.includes('characterData: true'), 'Dynamic text observation is missing');
assert(i18nSource.includes("attributeFilter: ['placeholder', 'title', 'aria-label']"), 'Dynamic attribute observation is missing');

assert(login.includes('/js/i18n.js'), 'Login does not load i18n');
assert(login.includes('loginLanguageSelect'), 'Login language selector is missing');
assert(login.includes('locals.branding.loginBackgroundUrl'), 'Login background binding is missing');
assert(login.includes('locals.branding.iconUrl'), 'Login custom icon binding is missing');
assert(sidebar.includes('/js/i18n.js'), 'Shared sidebar does not load i18n');
assert(sidebar.includes('rx-language-selector'), 'Authenticated language selector styling is missing');
assert(sidebar.includes('locals.branding.title'), 'Sidebar brand title binding is missing');

assert(!backoffice.includes('/js/i18n.js'), 'Backoffice must not load i18n');
assert(!backoffice.includes('rxLanguageSelect'), 'Backoffice must not contain a language selector');

['brand_title', 'brand_subtitle', 'brand_icon_class', 'brand_icon_url', 'login_background_url'].forEach(key => {
    assert(settingsService.includes(key), `Missing setting default: ${key}`);
    assert(settingsClient.includes(key), `Missing settings client binding: ${key}`);
});
assert(settingsView.includes('saveBrandingBtn'), 'Branding settings card is missing');
assert(settingsView.includes('brandIconGallery'), 'Transportation icon gallery is missing');
assert(settingsView.includes('minivan-passengers.svg'), 'Passenger minivan choice is missing');
assert(settingsView.includes('minivan-boarding.svg'), 'Boarding minivan choice is missing');
assert(settingsClient.includes('bindBrandIconGallery'), 'Transportation icon picker behavior is missing');
assert(passengerMinivanIcon.includes('<svg'), 'Passenger minivan SVG is invalid');
assert(boardingMinivanIcon.includes('<svg'), 'Boarding minivan SVG is invalid');
assert(settingsController.includes('safe same-site path'), 'Brand asset path validation is missing');
assert(settingsController.includes('Font Awesome class'), 'Brand icon class validation is missing');

assert(callCenterView.includes('data-i18n-ui'), 'Call Center loading UI is not marked for translation');
assert(callCenterClient.includes('data-i18n-ui>No access'), 'Call Center no-access UI is not marked for translation');
assert(callCenterClient.includes('data-i18n-ui>No eligible patients found.'), 'Call Center empty state is not marked for translation');

assert(appClient.includes('data-role-column="actions"'), 'CRUD Actions permission marker is missing');
assert(appClient.includes("getAttribute('data-modal-mode') !== 'edit'"), 'CRUD permissions still depend on translated modal text');
assert(patientsClient.includes("setAttribute('data-modal-mode', id ? 'edit' : 'add')"), 'Patient modal mode is not language-independent');
assert(crudView.includes('data-modal-mode="add"'), 'CRUD modal initial mode is missing');
assert(patientsView.includes('data-modal-mode="add"'), 'Patient modal initial mode is missing');
assert(!appClient.includes("textContent.trim().toLowerCase().startsWith('add')"), 'Permission logic must not inspect translated Add text');
assert(!appClient.includes("textContent.trim() === 'Actions'"), 'Permission logic must not inspect translated Actions text');
assert(appClient.includes("classList.toggle('d-none', !showCrud)"), 'CRUD Save visibility can remain stale across modal modes');
assert(appClient.includes("classList.toggle('d-none', !showPat)"), 'Patient Save visibility can remain stale across modal modes');
assert(reportsClient.includes('class="ac-item" data-i18n-skip'), 'Patient autocomplete business data must be excluded from translation');

const glossaryRows = glossary.split(/\r?\n/).filter(line => /^\| .+ \| .+ \|$/.test(line));
assert(glossaryRows.length >= 700, `Expected at least 700 glossary rows; found ${glossaryRows.length}`);

// Execute the browser dictionary in a minimal sandbox and prove default English,
// Spanish switching, and exact translation without a real DOM.
const storage = new Map();
const sandbox = {
    window: {
        dispatchEvent() {}
    },
    document: {
        readyState: 'loading',
        addEventListener() {},
        documentElement: { lang: 'en' }
    },
    localStorage: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); }
    },
    CustomEvent: function CustomEvent() {},
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: function MutationObserver() {},
    console
};
vm.createContext(sandbox);
vm.runInContext(i18nSource, sandbox);
assert.strictEqual(sandbox.window.RXI18n.getLanguage(), 'en');
storage.set('rxUiLanguage', 'es');
assert.strictEqual(sandbox.window.RXI18n.translate('Patients'), 'Pacientes');
assert.strictEqual(sandbox.window.RXI18n.translate('Call Queue'), 'Cola de llamadas');
assert.strictEqual(sandbox.window.RXI18n.translate('Calling from day 60 · Service eligible day 90'), 'Llamadas desde el día 60 · Servicio elegible el día 90');
assert.strictEqual(sandbox.window.RXI18n.translate('Page 2 of 14'), 'Página 2 de 14');
assert.strictEqual(sandbox.window.RXI18n.translate('Hello, Maria Rivera'), 'Hola, Maria Rivera');
assert.strictEqual(sandbox.window.RXI18n.translate('Acme Clinic 42'), 'Acme Clinic 42', 'Unknown/business text should be preserved');

console.log(`Localization and branding regression passed (${glossaryRows.length} glossary rows).`);
