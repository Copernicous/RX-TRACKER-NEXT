const db = require('../models');

// ---- helper: save a history snapshot ----
async function saveHistory(rxId, userId, changeType, snapshot, changedFields, note, transaction) {
    try {
        const opts = transaction ? { transaction } : {};
        await db.RXHistory.create({
            rxRecordId:    rxId,
            userId:        userId || null,
            changeType,
            snapshot:      JSON.stringify(snapshot),
            changedFields: changedFields ? JSON.stringify(changedFields) : null,
            note:          note || null
        }, opts);
    } catch (e) { /* never break main operation */ }
}

// ---- diff two plain objects for tracked fields ----
function diffObjects(before, after, fields) {
    const changes = [];
    for (const f of fields) {
        const bv = before[f] !== undefined ? before[f] : null;
        const av = after[f]  !== undefined ? after[f]  : null;
        if (String(bv) !== String(av)) changes.push({ field: f, from: bv, to: av });
    }
    return changes;
}

const TRACK_FIELDS = ['patientId','pharmacyId','patientTransportCompanyId',
                      'pharmacyTransportCompanyId','arrivalDate','serviceDate'];

// GET /api/rx-records
exports.getAll = async (req, res) => {
    try {
        // Accept both ?deleted=true and legacy ?includeDeleted=true
        const showDeleted = req.query.deleted === 'true' || req.query.includeDeleted === 'true';
        const where = showDeleted ? { isDeleted: true } : { isDeleted: false };
        const data = await db.RXRecord.findAll({
            where,
            include: [
                { model: db.Patient },
                { model: db.Pharmacy },
                { model: db.PatientTransportCompany },
                { model: db.PharmacyTransportCompany },
                { model: db.Medication },
                { model: db.RXWorkflowTracking }
            ],
            order: [['id', 'DESC']]
        });
        // Compute completedSteps array of workflowActionIds (expected by frontend)
        const result = data.map(rx => {
            const plain = rx.toJSON();
            plain.completedSteps = (plain.RXWorkflowTrackings || []).map(t => t.workflowActionId);
            return plain;
        });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/rx-records/:id
exports.getOne = async (req, res) => {
    try {
        const data = await db.RXRecord.findByPk(req.params.id, {
            include: [db.Patient, db.Pharmacy, db.Medication, db.RXWorkflowTracking]
        });
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/rx-records
exports.create = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { arrivalDate, serviceDate, medications, ...rxData } = req.body;

        const sDate = new Date(serviceDate);
        const aDate = new Date(arrivalDate);

        // LOGIC-01 FIX: Reject NaN/invalid dates before comparison
        if (!serviceDate || !arrivalDate || isNaN(sDate.getTime()) || isNaN(aDate.getTime())) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Arrival date and Service Date are required and must be valid dates.' });
        }

        const limitDate = new Date(sDate);
        limitDate.setDate(limitDate.getDate() - 90);

        if (aDate > sDate || aDate < limitDate) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Arrival date must be within 90 days prior to Service Date.' });
        }

        const rx = await db.RXRecord.create({ ...rxData, arrivalDate, serviceDate }, { transaction });

        if (medications && medications.length > 0) {
            const meds = medications.map(m => ({ ...m, rxRecordId: rx.id }));
            await db.Medication.bulkCreate(meds, { transaction });
        }

        // Auto-complete Step 1 (RX received warehouse) on creation
        const step1 = await db.WorkflowAction.findOne({
            where: { sequenceNumber: 1 },
            order: [['sequenceNumber', 'ASC']],
            transaction
        });
        if (step1) {
            await db.RXWorkflowTracking.create({
                rxRecordId:       rx.id,
                workflowActionId: step1.id,
                completionDate:   new Date(),
                userId:           req.user?.id || null
            }, { transaction });
        }

        await saveHistory(rx.id, req.user?.id, 'Create', rx.toJSON(), null,
            `Record created${step1 ? ' — auto-completed: ' + step1.name : ''}`, transaction);

        await transaction.commit();
        res.status(201).json(rx);
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};

// POST /api/rx-records/workflow
exports.updateWorkflow = async (req, res) => {
    try {
        const { rxId, actionId } = req.body;
        const rx = await db.RXRecord.findByPk(rxId);
        if (!rx) return res.status(404).json({ error: 'RX not found' });

        const action = await db.WorkflowAction.findByPk(actionId);
        if (!action) return res.status(404).json({ error: 'Action not found' });

        if (action.sequenceNumber > 1) {
            const prevAction = await db.WorkflowAction.findOne({ where: { sequenceNumber: action.sequenceNumber - 1 } });
            if (prevAction) {
                const prevCompleted = await db.RXWorkflowTracking.findOne({
                    where: { rxRecordId: rxId, workflowActionId: prevAction.id }
                });
                if (!prevCompleted) {
                    return res.status(400).json({ error: `Must complete '${prevAction.name}' before '${action.name}'.` });
                }
            }
        }

        const tracking = await db.RXWorkflowTracking.create({
            rxRecordId: rxId,
            workflowActionId: actionId,
            completionDate: new Date(),
            userId: req.user.id
        });

        // If this RX was previously returned to warehouse, clear the flag now that it's moving again
        if (rx.returnedToWarehouse && action.sequenceNumber > 1) {
            await rx.update({
                returnedToWarehouse: false,
                warehouseReturnDate: null,
                warehouseReturnNote: null
            });
        }

        await saveHistory(rxId, req.user?.id, 'Workflow', rx.toJSON(), null, `Step completed: ${action.name}`);

        res.json(tracking);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// POST /api/rx-records/bulk-workflow  (FEAT-10)
// Body: { rxIds: [1,2,3], actionId: 5 }
// Processes each record independently — partial success allowed.
exports.bulkWorkflow = async (req, res) => {
    try {
        const { rxIds, actionId } = req.body;

        if (!Array.isArray(rxIds) || rxIds.length === 0) {
            return res.status(400).json({ error: 'rxIds must be a non-empty array.' });
        }
        if (!actionId) {
            return res.status(400).json({ error: 'actionId is required.' });
        }
        // Cap at 200 records per batch to prevent abuse
        if (rxIds.length > 200) {
            return res.status(400).json({ error: 'Maximum 200 records per bulk operation.' });
        }

        const action = await db.WorkflowAction.findByPk(actionId);
        if (!action) return res.status(404).json({ error: 'Workflow action not found.' });

        // Pre-fetch previous step (needed for sequence guard)
        let prevAction = null;
        if (action.sequenceNumber > 1) {
            prevAction = await db.WorkflowAction.findOne({
                where: { sequenceNumber: action.sequenceNumber - 1 }
            });
        }

        var results = [];
        var succeeded = 0;
        var failed = 0;

        for (var i = 0; i < rxIds.length; i++) {
            var rxId = parseInt(rxIds[i], 10);
            if (isNaN(rxId)) {
                results.push({ rxId: rxIds[i], ok: false, error: 'Invalid ID.' });
                failed++;
                continue;
            }

            try {
                var rx = await db.RXRecord.findByPk(rxId);
                if (!rx) {
                    results.push({ rxId: rxId, ok: false, error: 'Record not found.' });
                    failed++;
                    continue;
                }
                if (rx.isDeleted) {
                    results.push({ rxId: rxId, ok: false, error: 'Record is hidden.' });
                    failed++;
                    continue;
                }

                // Sequence guard — same logic as updateWorkflow
                if (prevAction) {
                    var prevCompleted = await db.RXWorkflowTracking.findOne({
                        where: { rxRecordId: rxId, workflowActionId: prevAction.id }
                    });
                    if (!prevCompleted) {
                        results.push({
                            rxId: rxId,
                            ok: false,
                            error: 'Step \'' + prevAction.name + '\' not yet completed.'
                        });
                        failed++;
                        continue;
                    }
                }

                // Skip if already completed (idempotent)
                var alreadyDone = await db.RXWorkflowTracking.findOne({
                    where: { rxRecordId: rxId, workflowActionId: actionId }
                });
                if (alreadyDone) {
                    results.push({ rxId: rxId, ok: true, skipped: true, note: 'Already completed.' });
                    succeeded++;
                    continue;
                }

                await db.RXWorkflowTracking.create({
                    rxRecordId:      rxId,
                    workflowActionId: actionId,
                    completionDate:  new Date(),
                    userId:          req.user.id
                });

                // Clear warehouse flag if applicable
                if (rx.returnedToWarehouse && action.sequenceNumber > 1) {
                    await rx.update({
                        returnedToWarehouse: false,
                        warehouseReturnDate: null,
                        warehouseReturnNote: null
                    });
                }

                await saveHistory(rxId, req.user.id, 'Workflow', rx.toJSON(), null,
                    'Bulk step completed: ' + action.name);

                var patientLabel = '';
                try {
                    var fullRx = await db.RXRecord.findByPk(rxId, { include: [db.Patient] });
                    if (fullRx && fullRx.Patient) {
                        patientLabel = fullRx.Patient.firstName + ' ' + fullRx.Patient.lastName;
                    }
                } catch(e) { /* non-critical */ }

                results.push({ rxId: rxId, ok: true, patientName: patientLabel });
                succeeded++;

            } catch (rowErr) {
                results.push({ rxId: rxId, ok: false, error: rowErr.message || 'Unknown error.' });
                failed++;
            }
        }

        res.json({
            results:   results,
            succeeded: succeeded,
            failed:    failed,
            action:    { id: action.id, name: action.name }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/rx-records/workflow-date  (FEAT-11: Step date override)
// Body: { trackingId, newDate }  — newDate format: YYYY-MM-DD or ISO string
exports.updateWorkflowDate = async (req, res) => {
    try {
        const { trackingId, newDate } = req.body;
        if (!trackingId) return res.status(400).json({ error: 'trackingId is required.' });
        if (!newDate)    return res.status(400).json({ error: 'newDate is required.' });

        const parsed = new Date(newDate);
        if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid date format.' });

        // Prevent future dates
        if (parsed > new Date()) return res.status(400).json({ error: 'Completion date cannot be in the future.' });

        const tracking = await db.RXWorkflowTracking.findByPk(trackingId, {
            include: [{ model: db.WorkflowAction }, { model: db.RXRecord }]
        });
        if (!tracking) return res.status(404).json({ error: 'Workflow tracking record not found.' });

        const rx = tracking.RXRecord;
        if (!rx) return res.status(404).json({ error: 'Associated RX record not found.' });

        const action   = tracking.WorkflowAction;
        const oldDate  = tracking.completionDate ? new Date(tracking.completionDate).toLocaleString() : '(none)';
        const newLabel = parsed.toLocaleString();

        await tracking.update({ completionDate: parsed });

        await saveHistory(
            rx.id,
            req.user?.id,
            'Workflow Date Override',
            rx.toJSON(),
            null,
            `Step "${action ? action.name : '#' + trackingId}" date changed from ${oldDate} to ${newLabel} by ${req.user?.username || 'user'}`
        );

        res.json({ ok: true, trackingId, newDate: parsed, stepName: action ? action.name : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// POST /api/rx-records/undo-workflow
exports.undoWorkflow = async (req, res) => {
    try {
        const { rxId } = req.body;

        // BUG-03 FIX: Guard against null RX record before any further operations
        const rx = await db.RXRecord.findByPk(rxId);
        if (!rx) return res.status(404).json({ error: 'RX Record not found.' });

        const latestTracking = await db.RXWorkflowTracking.findOne({
            where: { rxRecordId: rxId },
            order: [['createdAt', 'DESC']],
            include: [{ model: db.WorkflowAction }]
        });

        if (!latestTracking) return res.status(400).json({ error: 'No workflow steps to undo.' });

        const stepName = latestTracking.WorkflowAction ? latestTracking.WorkflowAction.name : 'step';
        await latestTracking.destroy();

        await saveHistory(rxId, req.user?.id, 'Workflow', rx.toJSON(), null, `Step undone: ${stepName}`);

        res.status(200).json({ message: 'Undo successful' });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// POST /api/rx-records/return-to-warehouse
exports.returnToWarehouse = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId, note } = req.body;
        const rx = await db.RXRecord.findByPk(rxId);
        if (!rx) return res.status(404).json({ error: 'RX Record not found.' });

        // Find Step 1 (warehouse step — the first workflow action by sequenceNumber)
        const step1 = await db.WorkflowAction.findOne({
            where: { sequenceNumber: 1 },
            order: [['sequenceNumber', 'ASC']]
        });

        // Clear ALL workflow tracking steps
        await db.RXWorkflowTracking.destroy({ where: { rxRecordId: rxId }, transaction });

        // Auto-complete Step 1 (warehouse) so the RX sits at the warehouse position
        if (step1) {
            await db.RXWorkflowTracking.create({
                rxRecordId: rxId,
                workflowActionId: step1.id,
                completionDate: new Date(),
                userId: req.user.id
            }, { transaction });
        }

        // Mark the RX as returned to warehouse
        await rx.update({
            returnedToWarehouse: true,
            warehouseReturnDate: new Date(),
            warehouseReturnNote: note || null
        }, { transaction });

        await saveHistory(rxId, req.user?.id, 'Workflow', rx.toJSON(), null,
            `Returned to Warehouse${note ? ': ' + note : ''}${step1 ? ' — reset to Step 1: ' + step1.name : ''}`);

        await transaction.commit();
        res.status(200).json({ message: 'Returned to warehouse. Workflow reset to Step 1.' });
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};

// PUT /api/rx-records/:id
// H2 FIX: Explicit field whitelist — prevents arbitrary column writes via req.body
const RX_ALLOWED_FIELDS = [
    'patientId', 'arrivalDate', 'serviceDate',
    'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId',
    'notes'
];

exports.update = async (req, res) => {
    try {
        const before = await db.RXRecord.findByPk(req.params.id);
        if (!before) return res.status(404).json({ message: 'Not found' });
        const snapshot = before.toJSON();

        // Build a safe update payload from the whitelist only
        const safeData = {};
        RX_ALLOWED_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                const val = req.body[field];
                safeData[field] = (val === '' || val === undefined) ? null : val;
            }
        });

        const [updated] = await db.RXRecord.update(safeData, { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });

        const after = await db.RXRecord.findByPk(req.params.id);
        const changed = diffObjects(snapshot, after.toJSON(), TRACK_FIELDS);
        await saveHistory(before.id, req.user?.id, 'Update', snapshot, changed, null);

        res.json(after);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// DELETE /api/rx-records/:id (soft)
exports.delete = async (req, res) => {
    try {
        const rx = await db.RXRecord.findByPk(req.params.id);
        if (!rx) return res.status(404).json({ message: 'Not found' });
        const snapshot = rx.toJSON();
        await rx.update({ isDeleted: true, deletedAt: new Date() });
        await saveHistory(rx.id, req.user?.id, 'Delete', snapshot, null, 'Record soft-deleted');
        res.status(200).json({ message: 'Record hidden successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/rx-records/:id/restore
exports.restore = async (req, res) => {
    try {
        const rx = await db.RXRecord.findByPk(req.params.id);
        if (!rx) return res.status(404).json({ message: 'Not found' });
        const snapshot = rx.toJSON();
        await rx.update({ isDeleted: false, deletedAt: null });
        await saveHistory(rx.id, req.user?.id, 'Restore', snapshot, null, 'Record restored');
        res.status(200).json({ message: 'Record restored successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/rx-records/:id/history
exports.getHistory = async (req, res) => {
    try {
        const history = await db.RXHistory.findAll({
            where: { rxRecordId: req.params.id },
            include: [{ model: db.User, as: 'ChangedBy', attributes: ['firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(history);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
