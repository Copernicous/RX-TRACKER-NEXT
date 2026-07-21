# FortiGate SSL-VPN Proxy — Developer Reference Guide
> **Project:** Patient RX System · `rx.camperos.net:10443`  
> **Issue discovered:** June 2026 · **Status:** Fully resolved

---

## 1. What FortiGate Actually Does to Your Code

The FortiGate SSL-VPN **Agentless Portal** (`/proxy/…`) acts as a **man-in-the-middle HTTP rewriter**. It rewrites HTML, CSS, and JavaScript responses on the fly before delivering them to the browser.

The internal function responsible is called:

```
fgt_sslvpn.html_rewrite()
```

Its job is to rewrite all URLs in the page so they work through the proxy path instead of direct. For example, it turns:
```
/api/patients
```
into:
```
/proxy/15322ddf/http/192.168.15.87:3000/api/patients
```

**The bug:** FortiGate's rewriter is a dumb text scanner. It looks for patterns that *look like* URL-building code — and it doesn't understand JavaScript semantics. The specific pattern it targets is:

```js
}).join('')
```

When it finds this pattern at or near the end of a line, it wraps the entire expression with its rewriting function, producing broken JavaScript like:

```js
// ORIGINAL (valid JS):
tbody.innerHTML = rows.map(r => `<td>${r.name}</td>`).join('');

// AFTER FORTIGATE REWRITES IT (broken JS):
tbody.innerHTML = fgt_sslvpn.html_rewrite(rows.map(r => `<td>${r.name}</td>`).join(''));
//                ↑ adds this              ↑ and this closing paren ← mismatched!
```

This causes `SyntaxError: Unexpected token` or `Unexpected end of input` — the entire script file fails to parse and **nothing on the page works**.

---

## 2. The Pattern That Triggers FortiGate

> [!CAUTION]
> Any `.map(fn).join('')` that ends a statement line will be rewritten.

### ❌ Dangerous — Will Break

```js
// Pattern 1: Simple map-join on innerHTML
element.innerHTML = items.map(i => `<li>${i.name}</li>`).join('');

// Pattern 2: Multi-line map-join (the }).join('') is on its own line)
element.innerHTML = items.map(i => {
    return `<li>${i.name}</li>`;
}).join('');           // ← FortiGate REWRITES THIS LINE

// Pattern 3: Inside a template literal
container.innerHTML = `<table>
    <tbody>${rows.map(r => `<tr><td>${r.name}</td></tr>`).join('')}</tbody>
</table>`;             // ← FortiGate REWRITES the .join('') even inside ${}

// Pattern 4: Chained
const html = arr.filter(x => x.active).map(x => x.name).join('');

// Pattern 5: Template literals with ${ } containing variables → also risky
element.innerHTML = `<span style="color:${color}">${name}</span>`;
// FortiGate may interpret color= or href= inside template strings as URLs
```

### ✅ Safe — FortiGate Ignores

```js
// Pattern A: for loop with string accumulator
var html = '';
for (var i = 0; i < items.length; i++) {
    html += '<li>' + items[i].name + '</li>';
}
element.innerHTML = html;

// Pattern B: String concatenation (no backticks, no .join)
var html = '<li>' + item.name + '</li>';

// Pattern C: .join() with a non-empty separator (rarely triggers)
items.join(', ');    // FortiGate only targets .join('')

// Pattern D: API URL template literals (NOT assigned to innerHTML)
const url = `/api/roles/${id}`;   // Safe — never rendered as DOM
```

---

## 3. Secondary Trigger: Template Literals with Attributes

FortiGate also rewrites content it believes contains URLs. Inside template literals, if it sees patterns like `href=`, `src=`, `onclick=`, `color=` combined with `${}` expressions, it may partially rewrite the string.

**Worst case example:**

```js
// FortiGate sees "onclick=" + "${...}" and tries to rewrite the URL
const btn = `<button onclick="doThing(${id})">Click</button>`;
// May become:
const btn = `<button onclick="doThing(fgt_sslvpn.url_rewrite(${id}))">Click</button>`;
```

**Solution:** Use `data-*` attributes + event delegation instead of inline `onclick=`:

```js
// ❌ Dangerous: inline onclick with dynamic value
html += `<button onclick="editRole(${r.id})">Edit</button>`;

// ✅ Safe: data attribute + event listener
html += '<button data-edit-role="' + r.id + '">Edit</button>';

// One event listener on the parent handles all clicks:
tbody.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-edit-role]');
    if (btn) editRole(parseInt(btn.dataset.editRole));
});
```

---

## 4. The Inline Script Problem

FortiGate rewrites **inline `<script>` blocks** more aggressively than external `.js` files. This is because it processes the full HTML response character-by-character.

> [!WARNING]
> Large inline scripts in EJS templates (or any server-rendered HTML) are extremely vulnerable. The larger the script, the higher the chance of corruption.

### Rule: Always use external JS files

```html
<!-- ❌ Dangerous: large script inline in EJS -->
<script>
  // 200+ lines of JS here
  const html = modules.map(m => { ... }).join('');
</script>

<!-- ✅ Safe: move to /public/js/ and reference externally -->
<script src="/js/roles.js"></script>
```

**Why external files are safer:**
- FortiGate applies `Cache-Control: no-transform` more reliably to external file responses
- The rewriter focuses on HTML responses; JS MIME type (`application/javascript`) gets lighter processing
- Syntax errors in external files produce a console error but don't break the entire page

---

## 5. The Complete Safe Pattern

This is the **proven safe pattern** for every HTML-building function in this project:

```js
// ✅ CORRECT PATTERN — FortiGate safe

function renderTable(items) {
    var tbody = document.getElementById('myTableBody');
    
    // 1. Use var (not const/let in loops — less important but clearer)
    // 2. Use a string accumulator
    var html = '';
    
    // 3. Use for loop, NOT .map()
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        
        // 4. Use string concatenation, NOT template literals for DOM strings
        html += '<tr>' +
            '<td class="fw-bold" style="color:' + item.color + '">' + item.name + '</td>' +
            '<td>' + (item.active ? 'Active' : 'Inactive') + '</td>' +
            '<td>' +
                // 5. Use data-* attributes for event data, NOT onclick="fn(${id})"
                '<button data-id="' + item.id + '" class="btn btn-sm btn-primary">Edit</button>' +
            '</td>' +
        '</tr>';
    }
    
    // 6. Assign once at the end
    tbody.innerHTML = html;
    
    // 7. Handle events with delegation, NOT inline onclick
    tbody.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-id]');
        if (btn) editItem(parseInt(btn.dataset.id));
    });
}
```

---

## 6. What Is Safe vs What Is Not — Quick Reference

| Pattern | Safe? | Notes |
|---|---|---|
| `arr.map(fn).join('')` assigned to `innerHTML` | ❌ No | Primary trigger |
| `arr.map(fn).join('')` inside `${}` template | ❌ No | Still triggers |
| `` `<tag attr="${val}">` `` assigned to `innerHTML` | ⚠️ Maybe | Depends on attr type |
| `` `<tag onclick="fn(${id})">` `` | ❌ No | onclick + ${ } = danger |
| `` `<a href="${url}">` `` | ❌ No | href + ${ } = rewritten |
| `` `<span style="color:${c}">` `` | ⚠️ Maybe | color= sometimes ok |
| `` `/api/roles/${id}` `` (URL string only) | ✅ Yes | Not assigned to DOM |
| `showToast(\`msg ${val}\`)` | ✅ Yes | Not DOM innerHTML |
| `` `prompt('Enter name:', ${val})` `` | ✅ Yes | Not DOM innerHTML |
| `for` loop + string concat + `innerHTML =` | ✅ Yes | Proven safe |
| Inline `<script>` in EJS with maps | ❌ No | Move to external file |
| External `/public/js/*.js` file | ✅ Yes | Safer than inline |
| `data-*` attributes for event data | ✅ Yes | Best practice |
| CDN links (fonts, icons, CSS) | ❌ No | May fail to load through proxy |
| Local `/assets/` (fonts, FontAwesome) | ✅ Yes | Always use local |

---

## 7. Files Fixed in This Project

| File | Issue | Fix Applied |
|---|---|---|
| `views/roles.ejs` | Large inline script | Extracted to `roles.js` |
| `views/import.ejs` | Large inline script | Extracted to `import.js` |
| `views/system-settings.ejs` | Large inline script | Extracted to `system-settings.js` |
| `public/js/roles.js` | 8+ map-joins + template literals | All → for loops + string concat |
| `public/js/reports.js` | 3 map-joins | All → for loops |
| `public/js/audit-log.js` | 2 map-joins | All → for loops |
| `public/js/dashboard.js` | 1 map-join | → for loop |
| `public/js/app.js` | 8 map-joins | All → for loops |
| `public/js/patients.js` | 4 map-joins | All → for loops |
| `public/js/main.js` | 2 map-joins | All → for loops |
| `public/js/import.js` | 1 map-join | → for loop |
| `public/js/system-settings.js` | 1 map-join | → for loop |

---

## 8. How to Diagnose Future Issues

### Step 1: Check the browser console first
```
SyntaxError: Unexpected token ')'      ← FortiGate added an extra closing paren
SyntaxError: Unexpected end of input   ← FortiGate left a string unclosed
TypeError: X is not a function         ← FortiGate replaced a function with a string
```

### Step 2: View page source through the proxy
In Chrome: `view-source:https://rx.camperos.net:10443/proxy/…/roles`

Search for `fgt_sslvpn` — if you find it wrapped around your code, that's the problem.

### Step 3: Compare source directly vs through proxy
```
Direct:   http://192.168.15.87:3000/js/roles.js   (clean)
Via proxy: https://rx.camperos.net:10443/proxy/…/js/roles.js  (may be rewritten)
```

### Step 4: Check syntax locally
```powershell
node --check "e:\Documents\Patient RX\public\js\roles.js"
# Output: nothing = PASS, error message = FAIL
```

### Step 5: Scan for dangerous patterns
```powershell
# Find all remaining .join('') patterns
$lines = Get-Content ".\public\js\roles.js" -Encoding UTF8
for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "\.join\(''\)") {
        Write-Host "L$($i+1): $($lines[$i].Trim())"
    }
}
```

---

## 9. Adding New Pages — Checklist

When adding any new page that is accessed through the FortiGate proxy:

- [ ] **Move all JS to external files** — no large inline `<script>` blocks in EJS
- [ ] **Use `for` loops** instead of `.map().join('')` for all HTML building
- [ ] **Use string concatenation** (`'<td>' + val + '</td>'`) for DOM strings
- [ ] **Use `data-*` attributes** for anything dynamic in buttons/elements
- [ ] **Use event delegation** (`addEventListener` on parent) instead of `onclick=` in HTML
- [ ] **Use local assets** — no Google Fonts, CDN FontAwesome, or external CSS
- [ ] **Run `node --check`** on all new JS files before deploying
- [ ] **Test through the proxy** — not just direct at `192.168.15.87:3000`

---

## 10. Why This Only Happens Behind FortiGate

When you access the app **directly** at `http://192.168.15.87:3000`, the code works perfectly because:
- No rewriter sits between the server and browser
- JavaScript is delivered exactly as written

When you access through `https://rx.camperos.net:10443/proxy/…`:
- FortiGate intercepts every HTTP response
- It runs `html_rewrite()` on HTML and (partially) on JS
- The `.map().join('')` pattern gets wrapped with the FortiGate function
- The resulting JS has a syntax error and the script fails entirely
- The page appears blank or broken — even though the server-side and API are fine

> [!NOTE]
> The app's API endpoints (`/api/…`) are NOT affected — only the browser-side JavaScript rendering. Data is always correct; it's purely a display/rendering issue.

---

## 11. The favicon.ico 403 Error

```
Failed to load resource: 403 Forbidden  :10443/favicon.ico
```

**This is NOT your app's error.** The browser always auto-requests `/favicon.ico` from the root domain. Here, that root is the FortiGate portal (`rx.camperos.net:10443`), which has no favicon and returns 403. Your app's favicon loads fine through the proxy path. **Ignore this error.**

---

*Guide written June 2026 based on debugging session with Patient RX System at `rx.camperos.net:10443`*
