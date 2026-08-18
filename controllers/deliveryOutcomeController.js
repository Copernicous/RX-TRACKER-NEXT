const db = require('../models');

function normalizeOutcome(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['delivered', 'returned'].includes(normalized) ? normalized : null;
}

function driverDisplayName(driver) {
    if (!driver) return null;
    return String(driver.contactPerson || '').trim() || String(driver.companyName || '').trim() || `Pharmacy Transport #${driver.id}`;
}

exports.setOutcome = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId, actionId, outcome, note } = req.body || {};
        const normalizedOutcome = normalizeOutcome(outcome);
        if (!normalizedOutcome) throw new Error('Outcome must be delivered or returned.');

        const rx = await db.RXRecord.findByPk(rxId, { transaction, lock: transaction.LOCK.UPDATE });
        const action = await db.WorkflowAction.findByPk(actionId, { transaction });
        if (!rx || !action) {
            await transaction.rollback();
            return res.status(404).json({ error: 'RX record or workflow action not found.' });
        }
        if (!action.isActive) {
            await transaction.rollback();
            return res.status(400).json({
                error: 'This workflow action is inactive and cannot be completed.',
                code: 'WORKFLOW_ACTION_INACTIVE'
            });
        }
        if (action.deliveryOutcomeMode !== 'delivered_or_returned') {
            throw new Error('This workflow action is not configured for a delivery outcome.');
        }
        const currentDriver = rx.pharmacyTransportCompanyId
            ? await db.PharmacyTransportCompany.findByPk(rx.pharmacyTransportCompanyId, { transaction })
            : null;

        const existing = await db.RXWorkflowTracking.findOne({
            where: { rxRecordId: rx.id, workflowActionId: action.id },
            transaction
        });
        if (existing) {
            await transaction.rollback();
            return res.status(409).json({ error: 'Delivered has already been completed for this RX.' });
        }
        if (action.sequenceNumber > 1) {
            const previousAction = await db.WorkflowAction.findOne({
                where: { sequenceNumber: action.sequenceNumber - 1, isActive: true },
                order: [['sequenceNumber', 'ASC'], ['id', 'ASC']],
                transaction
            });
            if (previousAction && !await db.RXWorkflowTracking.findOne({
                where: { rxRecordId: rx.id, workflowActionId: previousAction.id },
                transaction
            })) {
                throw new Error(`Must complete '${previousAction.name}' before '${action.name}'.`);
            }
        }

        const completionDate = new Date();
        const returned = normalizedOutcome === 'returned';
        const outcomeNote = returned ? (String(note || '').trim() || null) : null;
        const tracking = await db.RXWorkflowTracking.create({
            rxRecordId: rx.id,
            workflowActionId: action.id,
            completionDate,
            userId: req.user.id,
            driverId: rx.pharmacyTransportCompanyId || null,
            driverNameSnapshot: driverDisplayName(currentDriver)
        }, { transaction });

        await db.RXDriverAssignmentHistory.create({
            rxRecordId: rx.id,
            workflowTrackingId: tracking.id,
            workflowActionId: action.id,
            workflowActionName: action.name,
            previousDriverId: null,
            previousDriverName: null,
            driverId: tracking.driverId || null,
            driverName: tracking.driverNameSnapshot || null,
            changeType: 'stage_snapshot',
            reason: `Driver captured when "${action.name}" was completed.`,
            userId: req.user.id
        }, { transaction });

        await rx.update({
            deliveryOutcome: returned ? 'returned_to_pharmacy' : 'delivered',
            deliveryOutcomeDate: completionDate,
            deliveryOutcomeNote: outcomeNote
        }, { transaction });

        const historyNote = returned
            ? `Delivered attempt recorded; package returned to pharmacy${outcomeNote ? `: ${outcomeNote}` : ''}`
            : 'Package delivered successfully';
        await db.RXHistory.create({
            rxRecordId: rx.id,
            userId: req.user.id,
            changeType: 'Delivery Outcome',
            snapshot: JSON.stringify(rx.toJSON()),
            changedFields: JSON.stringify({ actionId: action.id, outcome: normalizedOutcome, note: outcomeNote }),
            note: historyNote
        }, { transaction });

        await transaction.commit();
        res.json({ tracking, outcome: normalizedOutcome, returnedToPharmacy: returned });
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};
