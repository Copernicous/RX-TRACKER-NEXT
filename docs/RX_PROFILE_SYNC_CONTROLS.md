# RX Profile Sync controls (unreleased)

Backoffice > RX Profile Sync is off by default. There is no background job copying
profile values: scans compute differences and Sync explicitly copies selected
Pharmacy/Transport values into an RX. Patient fields are never changed by Sync.

Use Stop / leave off to persist a pause. Routine scans return no candidates and
both single and bulk Sync APIs reject writes. The pause waits for an already
running RX transaction to finish; remaining bulk entries recheck the setting and
stop copying. Choose RX created on/after (UTC), enable and Save controls when
needed. A starting date is required to enable. The date is inclusive from 00:00 UTC
and applies to RX createdAt, not arrival/service dates or patient modification.
Older RX records are excluded from scans and rejected by copy actions.

While paused, Review candidates while paused performs one explicit review scan
within the saved date scope. Select differences and use Mark reviewed / ignore,
or select up to 100 RX rows and Mark checked reviewed / ignore. Only append-only
review decisions and audit receipts are written: no patient values, RX values,
workflow, or RX change history is modified. Reviewed entries leave Pending; use
Reviewed/All to inspect them and Reopen to restore the decision. Decisions refer
to the current compared values; a later value change can legitimately need new
review. Pausing prevents routine scans regardless. Activity history remains
exportable. Controls survive restarts; sanitized copies reset to off.

No new migration or published release is included. Existing permissions and all
other patient/RX workflows remain unchanged.
