const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

// GET /api/roles — list all roles with user counts
exports.getAll = async (req, res) => {
    try {
        const roles = await db.Role.findAll({
            order: [['id', 'ASC']],
            include: [{
                model: db.User,
                attributes: ['id'],
                where: { isActive: true },
                required: false
            }]
        });
        const result = roles.map(r => ({
            id:          r.id,
            name:        r.name,
            description: r.description,
            isSystem:    r.isSystem,
            permissions: r.permissions,
            userCount:   r.Users ? r.Users.length : 0,
            createdAt:   r.createdAt,
            updatedAt:   r.updatedAt
        }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/roles/:id — single role
exports.getOne = async (req, res) => {
    try {
        const role = await db.Role.findByPk(req.params.id, {
            include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], where: { isActive: true }, required: false }]
        });
        if (!role) return res.status(404).json({ message: 'Role not found' });
        res.json({
            id:          role.id,
            name:        role.name,
            description: role.description,
            isSystem:    role.isSystem,
            permissions: role.permissions,
            userCount:   role.Users ? role.Users.length : 0,
            users:       role.Users || []
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/roles — create a new custom role
exports.create = async (req, res) => {
    try {
        const { name, description, permissions } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Role name is required.' });
        }
        // Check for duplicate name
        const existing = await db.Role.findOne({ where: { name: name.trim() } });
        if (existing) return res.status(400).json({ error: `A role named "${name.trim()}" already exists.` });

        const role = await db.Role.create({
            name: name.trim(),
            description: description || null,
            isSystem: false,
            permissions: permissions || null
        });
        res.status(201).json({ id: role.id, name: role.name, message: 'Role created.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// PUT /api/roles/:id — update role name, description, or permissions
exports.update = async (req, res) => {
    try {
        const role = await db.Role.findByPk(req.params.id);
        if (!role) return res.status(404).json({ message: 'Role not found' });

        const { name, description, permissions } = req.body;

        // System roles: allow editing permissions but not the name
        if (role.isSystem && name && name.trim() !== role.name) {
            return res.status(400).json({ error: 'Cannot rename a built-in system role.' });
        }

        await role.update({
            name:        (name && !role.isSystem) ? name.trim() : role.name,
            description: description !== undefined ? description : role.description,
            permissions: permissions !== undefined ? permissions : role.permissions
        });

        res.json({ id: role.id, name: role.name, message: 'Role updated.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// DELETE /api/roles/:id — delete a custom role (blocked if system or has users)
exports.delete = async (req, res) => {
    try {
        const role = await db.Role.findByPk(req.params.id, {
            include: [{ model: db.User, attributes: ['id'], where: { isActive: true }, required: false }]
        });
        if (!role) return res.status(404).json({ message: 'Role not found' });

        if (role.isSystem) {
            return res.status(400).json({ error: 'Cannot delete a built-in system role.' });
        }

        const userCount = role.Users ? role.Users.length : 0;
        if (userCount > 0) {
            return res.status(400).json({
                error: `Cannot delete role "${role.name}" — it is assigned to ${userCount} active user${userCount !== 1 ? 's' : ''}. Reassign them first.`
            });
        }

        await role.destroy();
        res.status(200).json({ message: `Role "${role.name}" deleted.` });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/roles/:id/duplicate — clone a role with a new name
exports.duplicate = async (req, res) => {
    try {
        const source = await db.Role.findByPk(req.params.id);
        if (!source) return res.status(404).json({ message: 'Role not found' });

        const newName = (req.body.name || `${source.name} (Copy)`).trim();
        const existing = await db.Role.findOne({ where: { name: newName } });
        if (existing) return res.status(400).json({ error: `A role named "${newName}" already exists.` });

        const clone = await db.Role.create({
            name:        newName,
            description: req.body.description || source.description,
            isSystem:    false,
            permissions: source.permissions   // copies the JSON blob
        });

        res.status(201).json({ id: clone.id, name: clone.name, message: 'Role duplicated.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// GET /api/roles/permission-defaults — returns built-in defaults for the matrix display
exports.getDefaults = (req, res) => {
    const matrix = {};
    Object.keys(BUILT_IN_DEFAULTS).forEach(r => { matrix[r] = BUILT_IN_DEFAULTS[r](); });
    res.json(matrix);
};
