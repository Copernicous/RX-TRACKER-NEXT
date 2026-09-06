# RX Tracker NEXT v4.0.0-next.84

This release adds editable City Region Rules so operators can manage which
Region tag is applied for each City without a code change.

## Production Update Notes

- Install through Project Control using the normal verified official release
  path.
- The migration creates the `CityRegionRules` table and seeds the approved
  Tampa-region city list.
- Patient edit/save and CSV import use the same rule table to apply the
  regional Patient Tag from City.
- On the Patient screen, City changes update the Region tag automatically
  without a browser confirmation prompt.
- Existing non-region Patient Tags remain unchanged.
- Existing fallback behavior remains when no custom city rule exists.

No proxy, VPN, FortiGate, cookie, `.env`, port, login/session, service
bootstrap, configured RX Action, or unrelated business-data rule is changed.
