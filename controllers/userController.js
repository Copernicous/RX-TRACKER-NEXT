const db = require('../models');
const bcrypt = require('bcryptjs');
const emailService = require('../services/emailService'); // IMPROVE-04: welcome email

async function withPhoneAccountStatus(users) {
    const list = Array.isArray(users) ? users : [users];
    const ids = list.filter(Boolean).map(user => user.id);
    const accounts = ids.length ? await db.UserSoftphoneAccount.findAll({
        where: { userId: { [db.Sequelize.Op.in]: ids } },
        attributes: ['userId', 'isEnabled']
    }) : [];
    const byUserId = new Map(accounts.map(account => [Number(account.userId), account]));
    const mapped = list.map(user => {
        if (!user) return null;
        const plain = typeof user.toJSON === 'function' ? user.toJSON() : user;
        const account = byUserId.get(Number(plain.id));
        const setupAvailable = plain.phoneAccountSetupAllowed === true;
        return {
            ...plain,
            phoneAccountConfigured: !!(account && account.isEnabled !== false),
            phoneAccountSetupAvailable: setupAvailable,
            phoneAccountStatus: setupAvailable
                ? 'Setup available'
                : (account && account.isEnabled !== false ? 'Configured' : 'Not configured')
        };
    });
    return Array.isArray(users) ? mapped : mapped[0];
}

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await db.User.findAll({ where, attributes: { exclude: ['passwordHash'] }, include: [db.Role] });
        res.json(await withPhoneAccountStatus(data));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await db.User.findByPk(req.params.id, { attributes: { exclude: ['passwordHash'] }, include: [db.Role] });
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(await withPhoneAccountStatus(data));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        const { password, ...otherData } = req.body;
        const passwordHash = await bcrypt.hash(password, 10);

        // SEC-03: Apply the same whitelist as update() — prevents arbitrary column writes.
        // Critical security fields are hard-forced to safe defaults regardless of request body.
        const safeData = {};
        USER_ALLOWED_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(otherData, field)) safeData[field] = otherData[field];
        });

        const data = await db.User.create({
            ...safeData,
            passwordHash,
            isMaster:         false,   // ← enforced: NEVER settable via API (PostgreSQL direct only)
            tokenVersion:     0,
            failedLoginCount: 0,
            lockedUntil:      null,
            twoFactorEnabled: false
        });
        res.status(201).json({ id: data.id, username: data.username });
        // IMPROVE-04: fire-and-forget welcome email (after response sent)
        emailService.sendWelcome({
            toEmail:   data.email,
            firstName: data.firstName,
            username:  data.username,
            sysUrl:    process.env.SYS_URL || ''
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// M2 FIX: Explicit field whitelist — prevents arbitrary column writes on user update
// NOTE: 'permissions' is intentionally removed — permissions are now role-based only
const USER_ALLOWED_FIELDS = [
    'firstName', 'lastName', 'username', 'email',
    'roleId', 'isActive', 'notes'
];

exports.update = async (req, res) => {
    try {
        const { password, ...otherData } = req.body;

        // Build safe update payload from whitelist only
        const safeData = {};
        USER_ALLOWED_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(otherData, field)) {
                safeData[field] = otherData[field];
            }
        });

        if (password) {
            safeData.passwordHash = await bcrypt.hash(password, 10);
        }

        const [updated] = await db.User.update(safeData, { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await db.User.findByPk(req.params.id, { attributes: { exclude: ['passwordHash'] } });
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
    try {
        const record = await db.User.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        // Safety: prevent disabling yourself
        const reqUser = req.user;
        if (reqUser && reqUser.id === record.id) {
            return res.status(400).json({ error: 'You cannot disable your own account.' });
        }
        await record.update({ isActive: false });
        res.status(200).json({ message: 'User disabled. They can no longer log in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const record = await db.User.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: true });
        res.status(200).json({ message: 'User restored. They can log in again.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
