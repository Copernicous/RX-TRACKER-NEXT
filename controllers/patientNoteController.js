const db = require('../models');

// Helper: get patient_notes permission for a user
function getNotesPerm(user) {
    if (!user) return { canAdd: false, canEdit: false, canDelete: false };
    // Administrators and Supervisors always have full note access
    if (user.role === 'Administrator' || user.role === 'Supervisor') {
        return { canAdd: true, canEdit: true, canDelete: true };
    }
    // Check stored granular permissions
    const perms = user.permissions || {};
    const np = perms.patient_notes || {};
    return {
        canAdd:    np.canAdd    !== undefined ? !!np.canAdd    : !!np.canEdit, // fallback for old data
        canEdit:   np.canEdit   !== undefined ? !!np.canEdit   : false,
        canDelete: np.canDelete !== undefined ? !!np.canDelete : false
    };
}

// GET /api/patients/:id/notes — list all notes for a patient
exports.getNotes = async (req, res) => {
    try {
        const [notes, workflowTrackings] = await Promise.all([
            db.PatientNote.findAll({
                where: { patientId: req.params.id },
                include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }],
                order: [['createdAt', 'DESC']]
            }),
            db.RXWorkflowTracking.findAll({
                where: { notes: { [db.Sequelize.Op.ne]: null } },
                include: [
                    {
                        model: db.RXRecord,
                        attributes: ['id', 'patientId', 'serviceDate'],
                        where: { patientId: req.params.id, isDeleted: false },
                        required: true
                    },
                    { model: db.WorkflowAction, attributes: ['id', 'name', 'sequenceNumber'], required: false },
                    { model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }
                ],
                order: [['updatedAt', 'DESC']]
            })
        ]);
        const workflowRows = workflowTrackings
            .map((tracking) => tracking.toJSON())
            .filter((tracking) => String(tracking.notes || '').trim());
        const workflowRxIds = [...new Set(workflowRows.map((tracking) => tracking.rxRecordId).filter(Boolean))];
        const workflowHistories = workflowRxIds.length
            ? await db.RXHistory.findAll({
                where: {
                    rxRecordId: { [db.Sequelize.Op.in]: workflowRxIds },
                    changeType: 'Workflow Note'
                },
                include: [{ model: db.User, as: 'ChangedBy', attributes: ['id', 'firstName', 'lastName', 'username'] }],
                order: [['createdAt', 'DESC']]
            })
            : [];
        const historyByWorkflowNote = new Map();
        workflowHistories.forEach((history) => {
            const plain = history.toJSON();
            let fields = [];
            try {
                fields = JSON.parse(plain.changedFields || '[]');
            } catch (_) {
                fields = [];
            }
            fields.forEach((fieldChange) => {
                const key = `${plain.rxRecordId}:${fieldChange.field}`;
                if (!historyByWorkflowNote.has(key)) historyByWorkflowNote.set(key, plain);
            });
        });

        const regularNotes = notes.map((note) => {
            const plain = note.toJSON();
            plain.kind = 'patient';
            plain.readOnly = false;
            return plain;
        });
        const workflowNotes = workflowRows
            .map((tracking) => {
                const history = historyByWorkflowNote.get(`${tracking.rxRecordId}:workflowNote:${tracking.workflowActionId}`);
                return {
                    id: `workflow-${tracking.id}`,
                    kind: 'workflow',
                    readOnly: true,
                    source: 'RX Workflow',
                    note: String(tracking.notes || '').trim(),
                    createdAt: history ? history.createdAt : (tracking.updatedAt || tracking.createdAt),
                    updatedAt: tracking.updatedAt,
                    Author: history ? history.ChangedBy : (tracking.User || null),
                    workflowTrackingId: tracking.id,
                    rxRecordId: tracking.rxRecordId,
                    rxServiceDate: tracking.RXRecord ? tracking.RXRecord.serviceDate : null,
                    workflowActionName: tracking.WorkflowAction ? tracking.WorkflowAction.name : null,
                    workflowActionSequence: tracking.WorkflowAction ? tracking.WorkflowAction.sequenceNumber : null,
                    workflowCompletionDate: tracking.completionDate
                };
            });

        res.json(regularNotes.concat(workflowNotes).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/patients/:id/notes — add a note
exports.addNote = async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'Note text is required.' });
        }

        // Permission check: canAdd on patient_notes (rbac middleware already checked, but defense-in-depth)
        const np = getNotesPerm(req.user);
        if (!np.canAdd) {
            return res.status(403).json({ error: 'You do not have permission to add patient notes.' });
        }

        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ error: 'Patient not found.' });

        const newNote = await db.PatientNote.create({
            patientId: req.params.id,
            userId: req.user ? req.user.id : null,
            note: note.trim(),
            source: 'Patient'
        });
        // Return with author info
        const full = await db.PatientNote.findByPk(newNote.id, {
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }]
        });
        res.status(201).json(full);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// DELETE /api/patients/:id/notes/:noteId — delete a note
exports.deleteNote = async (req, res) => {
    try {
        const note = await db.PatientNote.findOne({
            where: { id: req.params.noteId, patientId: req.params.id }
        });
        if (!note) return res.status(404).json({ error: 'Note not found.' });

        const np = getNotesPerm(req.user);

        // Strictly enforce canDelete — no author bypass
        if (!np.canDelete) {
            return res.status(403).json({
                error: 'You do not have permission to delete notes.'
            });
        }

        await note.destroy();
        res.status(204).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
};
