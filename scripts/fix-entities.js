/**
 * fix-entities.js
 * Replaces non-ASCII special characters with HTML entities in all EJS views.
 * Safe for FortiGate SSL web access which mangles UTF-8 multi-byte sequences.
 * Run once: node scripts/fix-entities.js
 */
const fs   = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views');

// Map: Unicode character → HTML entity (pure ASCII replacement)
const REPLACEMENTS = [
    ['\u2014', '&mdash;'],    // — em dash
    ['\u2013', '&ndash;'],    // – en dash
    ['\u201C', '&ldquo;'],    // " left double quote
    ['\u201D', '&rdquo;'],    // " right double quote
    ['\u2018', '&lsquo;'],    // ' left single quote
    ['\u2019', '&rsquo;'],    // ' right single quote / apostrophe
    ['\u2026', '&hellip;'],   // … ellipsis
    ['\u00A9', '&copy;'],     // © copyright
    ['\u2192', '&rarr;'],     // → right arrow
    ['\u2190', '&larr;'],     // ← left arrow
    ['\u2022', '&bull;'],     // • bullet
    ['\u2713', '&#10003;'],   // ✓ check mark
    ['\u26A0', '&#9888;'],    // ⚠ warning sign
    ['\u2122', '&trade;'],    // ™ trademark
    ['\u2460', '&#9312;'],    // ① circled 1
    ['\u2461', '&#9313;'],    // ② circled 2
    ['\u2462', '&#9314;'],    // ③ circled 3
    ['\u2463', '&#9315;'],    // ④ circled 4
    ['\u00B7', '&middot;'],   // · middle dot
    ['\u00A0', '&nbsp;'],     // non-breaking space
];

let totalChanged = 0;

fs.readdirSync(VIEWS)
    .filter(f => f.endsWith('.ejs'))
    .forEach(filename => {
        const filePath = path.join(VIEWS, filename);
        let content = fs.readFileSync(filePath, 'utf8');
        const original = content;

        for (const [char, entity] of REPLACEMENTS) {
            // Replace all occurrences
            content = content.split(char).join(entity);
        }

        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            // Count changes
            let changes = 0;
            for (const [char] of REPLACEMENTS) {
                changes += (original.split(char).length - 1);
            }
            console.log(`✓  ${filename}  (${changes} replacements)`);
            totalChanged++;
        } else {
            console.log(`-  ${filename}  (no changes)`);
        }
    });

console.log(`\nDone. ${totalChanged} files updated.`);
