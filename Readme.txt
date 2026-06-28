Patient RX System v2.0.66
=========================

Production Release: Patient Notice-Group Carousel

This package includes every production improvement through v2.0.66. The main new
feature in this release is a better Patient Management alert banner that rotates
through task groups instead of showing only one notice.

Included improvement
--------------------

v2.0.66 - Patient notice-group carousel
- Patient Management alert banner now shows Notice N of X when multiple task
  groups need attention.
- The Next button loops through all active notice groups.
- The banner rotates task categories, not individual patient rows.
- Show Patients applies the filter for the currently visible notice.
- Notice groups appear automatically only when the category has records.

Notice groups included
----------------------

- Expired 90-day window with incomplete RX workflow.
- Eligible now / past the 90-day service window.
- Service window expiring in 7 days or less.
- No service date.
- Active patients with no RX records.
- Missing required default information.

Database impact
---------------

- No schema changes are included.
- No destructive data changes are included.
- Existing patients, RX records, service-date cycles, workflow history, report
  data, and audit records are preserved.
- The notice groups use existing dashboard, patient, RX, and missing-info filters.

Production verification
-----------------------

After installing this package:

1. Confirm the sidebar/version badge shows v2.0.66.
2. Open Patient Management.
3. Confirm the alert banner shows Notice 1 of X when multiple task groups exist.
4. Click Next and confirm it cycles to the next notice group.
5. Continue clicking Next and confirm it loops back to the first notice.
6. Click Show Patients and confirm it applies the filter for the currently displayed notice.
7. Confirm Patients still defaults to 10 rows and normal filters still work.

Carried forward from v2.0.65
---------------------------

- Dashboard analytics and graphing improvements.
- RX Records database-level pagination.
- RX Records workflow-stage filtering.
- Patient Report and RX Action Report database-level pagination.
- CSV/Excel exports still export the full filtered result only when export is used.
- Production dashboard graph schema guards and fallback messaging.
