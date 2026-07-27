'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'public', 'js', 'i18n.js');
const outputPath = path.join(root, 'docs', 'UI_TRANSLATION_GLOSSARY.md');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractObject(name) {
    const startToken = `var ${name} = {`;
    const start = source.indexOf(startToken);
    if (start < 0) throw new Error(`Could not find ${name}`);
    const bodyStart = start + startToken.length;
    const end = source.indexOf('\n    };', bodyStart);
    if (end < 0) throw new Error(`Could not find end of ${name}`);
    const body = source.slice(bodyStart, end);
    const rows = [];
    const linePattern = /^\s*(["'])(.*?)\1:\s*(["'])(.*?)\3,?\s*$/gm;
    let match;
    while ((match = linePattern.exec(body))) {
        const english = Function(`"use strict"; return ${match[1]}${match[2]}${match[1]};`)();
        const spanish = Function(`"use strict"; return ${match[3]}${match[4]}${match[3]};`)();
        rows.push([english, spanish]);
    }
    return rows;
}

const rowMap = new Map();
extractObject('EXACT_ES')
    .concat(extractObject('SECOND_PASS_ES'))
    .concat(extractObject('PHRASE_ES'))
    .filter(([english]) => english !== '__SECOND_PASS_SENTINEL__')
    .forEach(([english, spanish]) => rowMap.set(english, spanish));
const rows = Array.from(rowMap.entries());
rows.sort((a, b) => a[0].localeCompare(b[0], 'en'));

const formattedRows = [
    ['Calling from day {start} · Service eligible day {eligible}', 'Llamadas desde el día {start} · Servicio elegible el día {eligible}'],
    ['Page {current} of {total}', 'Página {current} de {total}'],
    ['{start}-{end} of {total}', '{start}-{end} de {total}'],
    ['{range} / {count} calls|patients|dates', '{range} / {count} llamadas|pacientes|fechas'],
    ['+{count} more', '+{count} más'],
    ['Hello, {user name}', 'Hola, {user name}'],
    ['Connected for {duration}', 'Conectada durante {duration}'],
    ['Cooldown: {owner and seconds}', 'Espera: {owner and seconds}'],
    ['In use by {owner · call state}', 'En uso por {owner · call state}'],
    ['Call {phone} with {phone client}', 'Llamar al {phone} con {phone client}'],
    ['{count} records selected', '{count} registros seleccionados'],
    ['{count} filter(s)', '{count} filtro(s)'],
    ['Showing {range} of {total} records', 'Mostrando {range} de {total} registros'],
    ['{percent}% complete', '{percent}% completado'],
    ['Updated {time}', 'Actualizado {time}']
];

const escapeCell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const lines = [
    '# RX Tracker Next English-Spanish UI Translation Glossary',
    '',
    `Generated from \`public/js/i18n.js\`. Entries: **${rows.length}**.`,
    '',
    'English is the default UI language. Spanish affects interface text only. Patient names, notes, clinics, pharmacies, medications, addresses, documents, and other user-entered or stored business data are never translated.',
    '',
    'Backoffice is intentionally excluded: it does not load the translation script and its source files are not modified by this feature.',
    '',
    'To correct or add a translation:',
    '',
    '1. Edit `EXACT_ES` or `PHRASE_ES` in `public/js/i18n.js`.',
    '2. Run `node scripts/generate-i18n-glossary.js`.',
    '3. Run `npm run check:public-js` and the localization regression.',
    '4. Verify both English and Spanish in a browser.',
    '',
    '| English UI text | Spanish UI text |',
    '|---|---|',
    ...rows.map(([english, spanish]) => `| ${escapeCell(english)} | ${escapeCell(spanish)} |`),
    '',
    '## Formatted UI patterns',
    '',
    'Values inside braces are preserved from the application or business record; only the surrounding interface text is translated.',
    '',
    '| English UI pattern | Spanish UI pattern |',
    '|---|---|',
    ...formattedRows.map(([english, spanish]) => `| ${escapeCell(english)} | ${escapeCell(spanish)} |`),
    ''
];

fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${rows.length} translations to ${outputPath}`);
