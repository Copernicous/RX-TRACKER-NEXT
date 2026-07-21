'use strict';

const bcrypt = require('bcryptjs');

async function bootstrapAdmin(db, options = {}) {
  const username = String(options.username || '').trim();
  const email = String(options.email || '').trim();
  const password = String(options.password || '');
  const firstName = String(options.firstName || 'System').trim();
  const lastName = String(options.lastName || 'Administrator').trim();

  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error('Bootstrap username must be 3-64 characters using letters, numbers, dot, underscore, or hyphen.');
  }
  if (password.length < 12) {
    throw new Error('Bootstrap password must contain at least 12 characters.');
  }
  if (/^(admin|password|changeme|admin123)/i.test(password)) {
    throw new Error('Bootstrap password is too predictable.');
  }

  const existingUsers = await db.User.count();
  if (existingUsers > 0) {
    throw new Error('Admin bootstrap is first-run only. Users already exist; no account was changed.');
  }

  const adminRole = await db.Role.findOne({ where: { name: 'Administrator', isSystem: true } });
  if (!adminRole) {
    throw new Error('Administrator role is missing. Run seed-reference before bootstrap-admin.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.User.create({
    firstName,
    lastName,
    username,
    email: email || null,
    passwordHash,
    roleId: adminRole.id,
    isActive: true,
    isMaster: options.master === true
  });

  return { id: user.id, username: user.username, isMaster: user.isMaster === true };
}

module.exports = { bootstrapAdmin };
