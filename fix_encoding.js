const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'views', 'reports.ejs');

// Read raw bytes
const buf = fs.readFileSync(file);
// Convert to string treating as latin1 so we can see actual bytes
let content = buf.toString('utf8');

// The corrupted sequence is the UTF-8 bytes of em-dash (E2 80 94)
// being stored correctly but displayed wrong in the terminal.
// Actually the file has been double-encoded: latin1 chars â€" where — should be.
// Replace â€" (the 3 chars: 0xC3 0xA2, 0xE2 0x80, 0xE2 0x80 ... ) 
// Actually simplest: just replace the literal string as it appears in the file
const bad = '\u00e2\u20ac\u201d'; // â€" in unicode codepoints
const good = '-';

const count = (content.split(bad)).length - 1;
console.log('Found', count, 'corrupted sequences');
content = content.split(bad).join(good);

// Also fix corrupted arrow
const badArrow = '\u00e2\u2020\u2019';
content = content.split(badArrow).join('->');

fs.writeFileSync(file, content, 'utf8');

const after = (fs.readFileSync(file, 'utf8').split(bad)).length - 1;
console.log('Remaining:', after);
console.log('Done');
