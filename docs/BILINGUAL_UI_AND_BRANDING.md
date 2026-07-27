# Bilingual UI and branding

RX Tracker Next defaults to English and supports Spanish for the program interface.

## Language scope

The language selector appears on the login page and in the shared sidebar. The choice is stored in the browser as `rxUiLanguage`, so it persists without changing patient or application records.

Translated content includes navigation, headings, buttons, labels, placeholders, filters, status labels, common dialogs, validation messages, and common notifications.

The second-pass catalog also covers Call Center metric cards, dynamic card
titles and subtitles, eligibility ranges, pagination, queue statuses, phone
and pairing messages, plus the primary Dashboard, Patients, RX Records,
Reports, Import, Audit, live-phone, active-session, and System Settings UI.
The runtime watches later text and accessibility-attribute updates so UI
rendered by page scripts is translated after it changes.

The translator intentionally skips ordinary table-body values and form values. It does not translate:

- patient names, IDs, notes, phone numbers, or addresses;
- clinic, pharmacy, transport, medication, or workflow data entered by users;
- uploaded documents;
- database records or exports containing business data;
- Backoffice.

Backoffice remains English-only and does not load `public/js/i18n.js`.

## Maintaining translations

The runtime dictionary is `public/js/i18n.js`. The generated review table is `docs/UI_TRANSLATION_GLOSSARY.md`.

The glossary includes both fixed interface strings and formatted patterns.
Values inside formatted-pattern braces (for example a user name, phone number,
count, or date range) are preserved; only the surrounding interface wording is
translated.

After changing the dictionary:

```powershell
node scripts/generate-i18n-glossary.js
npm run check:public-js
```

Then verify login and at least Dashboard, Patients, RX Records, Call Center, Reports, and System Settings in both languages.

## Branding settings

Administrators can open **System Settings > General > Login and Sidebar Branding** and configure:

- browser application name;
- login and sidebar title;
- login subtitle;
- fallback Font Awesome icon class;
- optional custom icon path;
- optional login background path.

System Settings also provides a visual icon gallery with medication, minivan,
passenger van, car service, taxi, community shuttle, accessible transport, and
medical transport choices. Two bundled custom SVG choices represent people
riding in a minivan and a passenger boarding a minivan. Choosing a gallery
item fills the same audited icon-class and icon-path settings; it does not add
a new database setting.

Custom image paths must be same-site paths beginning with `/`, such as:

```text
/images/company-logo.png
/images/login-background.jpg
```

Place image files under `public/images` before saving those paths. External URLs and parent-directory paths are rejected. Leaving an image path blank restores the built-in icon or gradient.

Brand text is treated as the organization’s chosen name and is not automatically translated.
