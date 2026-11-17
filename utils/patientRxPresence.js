'use strict';

// Fixed Sequelize Patient alias; RX with a missing service date still counts.
// Keep live dashboard counts and their drilldown on the same all-history scope.
exports.noRxPatientSql = `"Patient"."isActive" IS TRUE
    AND "Patient"."isDeleted" IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM "RXRecords" AS rx_presence
        WHERE rx_presence."patientId" = "Patient".id AND rx_presence."isDeleted" IS NOT TRUE)`;
