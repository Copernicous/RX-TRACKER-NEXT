function normalizeRoleName(user) {
  return String((user && (user.role || user.roleName)) || '').trim().toLowerCase();
}

function normalizePermissions(user) {
  if (!user) return {};
  if (user.permissions && typeof user.permissions === 'object') return user.permissions;
  return {};
}

function isCallCenterRole(user) {
  return normalizeRoleName(user) === 'call center';
}

function hasCallCenterAccess(user) {
  const role = normalizeRoleName(user);
  if (role === 'administrator' || role === 'supervisor' || role === 'call center') return true;

  const perms = normalizePermissions(user);
  return !!(perms.call_center && perms.call_center.visible);
}

function canReviewCallCenter(user) {
  const role = normalizeRoleName(user);
  if (role === 'administrator' || role === 'supervisor') return true;

  const perms = normalizePermissions(user);
  return !!(perms.call_center && perms.call_center.canExport);
}

module.exports = {
  normalizeRoleName,
  isCallCenterRole,
  hasCallCenterAccess,
  canReviewCallCenter
};
