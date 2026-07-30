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
const dashboardClient = read('public/js/dashboard.js');
const dashboardView = read('views/dashboard.ejs');
const rxRecordsView = read('views/rx-records.ejs');
const helpClient = read('public/js/help.js');
const passengerMinivanIcon = read('public/images/brand-icons/minivan-passengers.svg');
const boardingMinivanIcon = read('public/images/brand-icons/minivan-boarding.svg');

assert(i18nSource.includes("'Patients': 'Pacientes'"), 'Spanish Patients translation is missing');
assert(i18nSource.includes("'All Incomplete': 'Todos incompletos'"), 'Spanish All Incomplete translation is missing');
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
assert(sidebar.includes('window.APP_TIME_ZONE'), 'Configured application timezone is not exposed to authenticated UI formatting');
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
assert(
    dashboardClient.includes('Current Stage Breakdown &mdash; RX records by latest completed step'),
    'Dashboard pipeline must describe the Current Stage breakdown accurately'
);
assert(
    dashboardClient.includes('step.count / stepBreakdownTotal'),
    'Current Stage bars must scale against the full breakdown total'
);
assert(!dashboardClient.includes('var completedPct ='), 'Dashboard must not render a duplicate Completed breakdown row');
assert(dashboardClient.includes('<div data-i18n-skip'), 'Configured workflow action names must not be translated');
assert(dashboardClient.includes("setTxt('rxPipelineExpired'"), 'Dashboard client does not render the Expired count');
assert(dashboardClient.includes('rxPipelineAllIncomplete'), 'Dashboard charts do not preserve All Incomplete totals');
assert(dashboardView.includes('workflowStatus=incomplete'), 'Dashboard Pending card must link to All Incomplete');
assert(dashboardView.includes('id="rxPipelineExpired"'), 'Dashboard Expired Workflow Status card is missing');
assert(dashboardView.includes('id="xl-rx-records-not-started"'), 'Dashboard Not Started card link is missing');
assert(dashboardView.includes('id="xl-rx-records-in-progress"'), 'Dashboard In Progress card link is missing');
assert(dashboardView.includes('id="xl-rx-records-expired"'), 'Dashboard Expired card link is missing');
assert(dashboardView.includes('id="xl-rx-records-completed"'), 'Dashboard Completed card link is missing');
assert(dashboardView.includes('workflowStatus=expired'), 'Dashboard Expired card must link to the Expired filter');
assert(rxRecordsView.includes("{ id: 'incomplete', name: 'All Incomplete' }"), 'RX Records All Incomplete filter is missing from the multi-select picker');
assert(rxRecordsView.includes('id="rxFilterCurrentStageDateFrom"'), 'RX Records Current Stage Date From filter is missing');
assert(rxRecordsView.includes('id="rxFilterCurrentStageDateTo"'), 'RX Records Current Stage Date To filter is missing');
assert(rxRecordsView.includes("'currentStageDateFrom'"), 'RX Records does not send Current Stage Date From');
assert(rxRecordsView.includes("'currentStageDateTo'"), 'RX Records does not send Current Stage Date To');
assert(rxRecordsView.includes("'Current Stage Date'"), 'RX Records CSV is missing Current Stage Date');
assert(rxRecordsView.includes('rxCsvDate(i.currentDate,true)'), 'Current Stage Date CSV is not app-timezone formatted');
assert(rxRecordsView.includes("timeZone: window.APP_TIME_ZONE"), 'Current Stage Date fallback does not use the configured app timezone');
assert(!rxRecordsView.includes('if (_wfToday > _wfExp) {'), 'RX Records must not label a completed old RX as Expired');
const legacySortSource = rxRecordsView.slice(
    rxRecordsView.indexOf('function getRxWorkflowSortValue'),
    rxRecordsView.indexOf('function applyRxFilter')
);
assert(
    legacySortSource.indexOf('completedSteps >= totalSteps') < legacySortSource.indexOf('var svc ='),
    'Legacy RX sorting must give Completed precedence over an old service date'
);
assert(i18nSource.includes("'Current Stage Date From': 'Fecha de la etapa actual desde'"), 'Spanish Current Stage Date From translation is missing');
assert(i18nSource.includes("'Current Stage Date To': 'Fecha de la etapa actual hasta'"), 'Spanish Current Stage Date To translation is missing');
assert(helpClient.includes('highest active workflow step completed'), 'Dashboard pipeline help still describes Next Action semantics');
assert(helpClient.includes('including expired cycles'), 'Dashboard Pending help must disclose expired-cycle inclusion');
assert(helpClient.includes('mutually exclusive Workflow Status groups'), 'Dashboard pipeline help must explain the four status groups');
assert(helpClient.includes('Expired RX remain included in their actual Current Stage'), 'Dashboard help must preserve Expired Current Stage semantics');
assert(helpClient.includes('Filtering by Current Stage completion date'), 'RX help must explain Current Stage Date filtering');
assert(helpClient.includes('Not Started records have no Current Stage date'), 'RX help must explain null Current Stage dates');
assert(helpClient.includes('configured application timezone'), 'RX help must explain the configured-timezone date boundary');

const glossaryRows = glossary.split(/\r?\n/).filter(line => /^\| .+ \| .+ \|$/.test(line));
assert(glossaryRows.length >= 700, `Expected at least 700 glossary rows; found ${glossaryRows.length}`);
assert(
    glossary.includes('| Current Stage Breakdown — RX records by latest completed step | Desglose por etapa actual — registros RX según el último paso completado |'),
    'Generated glossary is missing the Current Stage breakdown translation'
);
assert(glossary.includes('| All Incomplete | Todos incompletos |'), 'Generated glossary is missing All Incomplete');
assert(glossary.includes('| Expired | Vencido |'), 'Generated glossary is missing Expired');
assert(
    glossary.includes('| Current Stage Date From | Fecha de la etapa actual desde |'),
    'Generated glossary is missing Current Stage Date From'
);
assert(
    glossary.includes('| Current Stage Date To | Fecha de la etapa actual hasta |'),
    'Generated glossary is missing Current Stage Date To'
);
assert(
    glossary.includes('| Open Advanced in RX Records and use Current Stage Date From and Current Stage Date To.'),
    'Generated glossary is missing the complete Current Stage Date help answer'
);
assert(
    glossary.includes('| Expired RX remain shown in their actual Current Stage. | Los RX vencidos permanecen visibles en su etapa actual real. |'),
    'Generated glossary is missing the Expired Current Stage explanation'
);
assert(glossary.includes('| {percent}% complete | {percent}% completado |'), 'Generated glossary is missing the completion pattern');
assert(glossary.includes('| Updated {time} | Actualizado {time} |'), 'Generated glossary is missing the updated-time pattern');

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
assert.strictEqual(sandbox.window.RXI18n.translate('All Incomplete'), 'Todos incompletos');
assert.strictEqual(sandbox.window.RXI18n.translate('Expired'), 'Vencido');
assert.strictEqual(
    sandbox.window.RXI18n.translate('Current Stage Date From'),
    'Fecha de la etapa actual desde'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('Current Stage Date To'),
    'Fecha de la etapa actual hasta'
);
const currentStageDateHelp = 'Open Advanced in RX Records and use Current Stage Date From and Current Stage Date To. The range is inclusive in the configured application timezone and uses the completion timestamp of the RX record\'s actual Current Stage. It is independent from Service Date and Next Action Required. Not Started records have no Current Stage date and are excluded when either date filter is used.';
assert.strictEqual(
    sandbox.window.RXI18n.translate(currentStageDateHelp),
    'Abra Avanzado en Registros RX y use Fecha de la etapa actual desde y Fecha de la etapa actual hasta. El rango es inclusivo en la zona horaria configurada de la aplicación y usa la fecha y hora de finalización de la etapa actual real del registro RX. Es independiente de Fecha de servicio y Próxima acción requerida. Los registros No iniciados no tienen una fecha de etapa actual y se excluyen cuando se usa cualquiera de los filtros de fecha.'
);
assert.strictEqual(sandbox.window.RXI18n.translate('Call Queue'), 'Cola de llamadas');
assert.strictEqual(sandbox.window.RXI18n.translate('Calling from day 60 · Service eligible day 90'), 'Llamadas desde el día 60 · Servicio elegible el día 90');
assert.strictEqual(sandbox.window.RXI18n.translate('Page 2 of 14'), 'Página 2 de 14');
assert.strictEqual(sandbox.window.RXI18n.translate('Hello, Maria Rivera'), 'Hola, Maria Rivera');
assert.strictEqual(
    sandbox.window.RXI18n.translate('Current Stage Breakdown — RX records by latest completed step'),
    'Desglose por etapa actual — registros RX según el último paso completado'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('No workflow steps configured yet.'),
    'Aún no hay etapas del flujo de trabajo configuradas.'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('Could not load pipeline data.'),
    'No se pudieron cargar los datos del flujo de trabajo.'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('RX Pipeline chart — reading the bars'),
    'Gráfico del flujo RX: cómo leer las barras'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('Expired RX remain shown in their actual Current Stage.'),
    'Los RX vencidos permanecen visibles en su etapa actual real.'
);
assert.strictEqual(
    sandbox.window.RXI18n.translate('The four summary cards are mutually exclusive Workflow Status groups: Not Started, In Progress, Expired, and Completed. Each horizontal bar below shows the RX record\'s actual Current Stage (the highest active workflow step completed). Expired RX remain included in their actual Current Stage, so the stage bars continue to match the Current Stage filters.'),
    'Las cuatro tarjetas de resumen son grupos mutuamente excluyentes del estado del flujo de trabajo: No iniciado, En curso, Vencido y Completado. Cada barra horizontal inferior muestra la etapa actual real del registro RX (la etapa activa más avanzada que se completó). Los RX vencidos permanecen incluidos en su etapa actual real, por lo que las barras continúan coincidiendo con los filtros de Etapa actual.'
);
assert.strictEqual(sandbox.window.RXI18n.translate('91% complete'), '91% completado');
assert.strictEqual(sandbox.window.RXI18n.translate('Updated 4:15:56 PM'), 'Actualizado 4:15:56 PM');
assert.strictEqual(sandbox.window.RXI18n.translate('Acme Clinic 42'), 'Acme Clinic 42', 'Unknown/business text should be preserved');

console.log(`Localization and branding regression passed (${glossaryRows.length} glossary rows).`);
