'use strict';

const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

function getRolePermissions(role) {
    if (!role) return {};
    return role.permissions ||
        (BUILT_IN_DEFAULTS[role.name] ? BUILT_IN_DEFAULTS[role.name]() : {});
}

async function loadUserAuthContext(userId) {
    const user = await db.User.findByPk(userId, {
        attributes: [
            'id',
            'username',
            'firstName',
            'lastName',
            'roleId',
            'isActive',
            'tokenVersion',
            'isMaster',
            'phoneAccountSetupAllowed'
        ],
        include: [{ model: db.Role, attributes: ['id', 'name', 'isSystem', 'permissions'] }]
    });

    if (!user || !user.Role) return null;

    return {
        user,
        role: user.Role,
        permissions: getRolePermissions(user.Role)
    };
}

function hydrateDecodedUser(decoded, context) {
    if (!decoded || !context || !context.user || !context.role) return decoded;
    decoded.username = context.user.username;
    decoded.firstName = context.user.firstName;
    decoded.lastName = context.user.lastName;
    decoded.role = context.role.name;
    decoded.roleId = context.user.roleId;
    decoded.permissions = context.permissions;
    decoded.isMaster = context.user.isMaster === true;
    decoded.phoneAccountSetupAllowed = context.user.phoneAccountSetupAllowed === true;
    return decoded;
}

module.exports = {
    getRolePermissions,
    loadUserAuthContext,
    hydrateDecodedUser
};
