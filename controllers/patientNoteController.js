const db = require('../models');

// Helper: get patient_notes permission for a user
function getNotesPerm(user) {
    if (!user) return { canEdit: false, canDelete: false };
    // Administrators and Supervisors always have full note access
    if (user.role === 'Administrator' || user.role === 'Supervisor') {
        return { canEdit: true, canDelete: true };
    }
    // Check stored granular permissions
    const perms = user.permissions || {};
    const np = perms.patient_notes || {};
    return {
        canEdit:   np.canEdit   !== undefined ? !!np.canEdit   : true,  // default allow add
        canDelete: np.canDelete !== undefined ? !!np.canDelete : false  // default deny delete
    };
}

// GET /api/patients/:id/notes — list all notes for a patient
exports.getNotes = async (req, res) => {
    try {
        const notes = await db.PatientNote.findAll({
            where: { patientId: req.params.id },
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(notes);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/patients/:id/notes — add a note
exports.addNote = async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'Note text is required.' });
        }

        // Permission check: canEdit on patient_notes
        const np = getNotesPerm(req.user);
        if (!np.canEdit) {
            return res.status(403).json({ error: 'You do not have permission to add patient notes.' });
        }

        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ error: 'Patient not found.' });

        const newNote = await db.PatientNote.create({
            patientId: req.params.id,
            userId: req.user ? req.user.id : null,
            note: note.trim()
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

        const user = req.user;
        const np   = getNotesPerm(user);
        const isAuthor = note.userId === user?.id;

        // Allow: canDelete permission OR author deleting their own note
        if (!np.canDelete && !isAuthor) {
            return res.status(403).json({
                error: 'You do not have permission to delete this note. Only users with delete permission or the note author can remove notes.'
            });
        }

        await note.destroy();
        res.status(204).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
};
