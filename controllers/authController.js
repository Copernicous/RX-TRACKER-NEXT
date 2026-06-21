const jwt    = require('jsonwebtoken');
const db     = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.User.findOne({
            where: { username, isActive: true },
            include: [{ model: db.Role }]
        });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials or inactive account' });
        }

        const validPassword = await user.validPassword(password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.Role.name },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Log login
        await db.AuditLog.create({
            userId:    user.id,
            date:      new Date(),
            time:      new Date().toTimeString().split(' ')[0],
            module:    'Authentication',
            action:    'Login',
            ipAddress: req.ip
        });

        // Permissions come from the Role record — fall back to built-in if not yet seeded
        const rolePerms = user.Role.permissions ||
            (BUILT_IN_DEFAULTS[user.Role.name] ? BUILT_IN_DEFAULTS[user.Role.name]() : {});

        res.json({
            message: 'Login successful',
            token,
            user: {
                id:          user.id,
                username:    user.username,
                firstName:   user.firstName,
                lastName:    user.lastName,
                role:        user.Role.name,
                roleId:      user.roleId,
                permissions: rolePerms   // ← from Role, not from User
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: { exclude: ['passwordHash'] },
            include: [{ model: db.Role }]
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};
