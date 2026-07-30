const db = require('../models');
function normalizeOutcome(value) { const normalized = String(value || '').trim().toLowerCase(); return ['delivered', 'returned'].includes(normalized) ? normalized : null; }
exports.setOutcome = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId, actionId, outcome, note } = req.body || {};
        const normalizedOutcome = normalizeOutcome(outcome);
        if (!normalizedOutcome) throw new Error('Outcome must be delivered or returned.');
        const rx = await db.RXRecord.findByPk(rxId, { transaction });
        const action = await db.WorkflowAction.findByPk(actionId, { transaction });
        if (!rx || !action) { await transaction.rollback(); return res.status(404).json({ error: 'RX record or workflow action not found.' }); }
        if (action.deliveryOutcomeMode !== 'delivered_or_returned') throw new Error('This workflow action is not configured for a delivery outcome.');
        const existing = await db.RXWorkflowTracking.findOne({ where: { rxRecordId: rx.id, workflowActionId: action.id }, transaction });
        if (existing) { await transaction.rollback(); return res.status(409).json({ error: 'Delivered has already been completed for this RX.' }); }
        if (action.sequenceNumber > 1) {
            const previousAction = await db.WorkflowAction.findOne({ where: { sequenceNumber: action.sequenceNumber - 1 }, transaction });
            if (previousAction && !await db.RXWorkflowTracking.findOne({ where: { rxRecordId: rx.id, workflowActionId: previousAction.id }, transaction })) throw new Error(`Must complete '${previousAction.name}' before '${action.name}'.`);
        }
        const completionDate = new Date();
        const tracking = await db.RXWorkflowTracking.create({ rxRecordId: rx.id, workflowActionId: action.id, completionDate, userId: req.user.id }, { transaction });
        const returned = normalizedOutcome === 'returned';
        await rx.update({ returnedToWarehouse: returned, warehouseReturnDate: returned ? completionDate : null, warehouseReturnNote: returned ? (String(note || '').trim() || null) : null }, { transaction });
        const historyNote = returned ? `Delivered attempt recorded; package returned to pharmacy${note ? `: ${String(note).trim()}` : ''}` : 'Package delivered successfully';
        await db.RXHistory.create({ rxRecordId: rx.id, userId: req.user.id, changeType: 'Delivery Outcome', snapshot: JSON.stringify(rx.toJSON()), changedFields: JSON.stringify({ actionId: action.id, outcome: normalizedOutcome, note: returned ? (String(note || '').trim() || null) : null }), note: historyNote }, { transaction });
        await transaction.commit();
        res.json({ tracking, outcome: normalizedOutcome, returnedToWarehouse: returned });
    } catch (err) { await transaction.rollback(); res.status(400).json({ error: err.message }); }
};
