'use strict';

const {
  normalizeArray,
  getIdentityFromUser,
} = require('./identity');

const ROLE_HIERARCHY = { ADMIN: 3, MANAGER: 2, USER: 1 };
const ROLE_SCOPE_ALIASES = {
  ADMIN: ['ADMIN', 'admin.users', 'admin.roles', 'admin.logs', 'admin.sync', 'admin.ml'],
  MANAGER: ['MANAGER', 'analytics.read', 'dashboard.read', 'orders.write', 'export.csv'],
  USER: ['USER', 'orders.read', 'authenticated-user'],
};

function scopeMatches(scope, expected) {
  return scope === expected || scope.endsWith(`.${expected}`);
}

function getTokenPayload(user) {
  if (typeof user?.tokenInfo?.getPayload === 'function') return user.tokenInfo.getPayload();
  return user?.jwt || user?._?.jwt || {};
}

function getConfiguredDevAdmins() {
  if (process.env.SMARTORDER_ENABLE_DEV_ADMIN !== 'true') return [];
  return normalizeArray((process.env.SMARTORDER_DEV_ADMINS || '').replace(/,/g, ' '))
    .map((value) => value.toLowerCase());
}

function isDevAdminOverride(user) {
  const devAdmins = getConfiguredDevAdmins();
  if (!devAdmins.length || !user) return false;

  const identity = getIdentityFromUser(user);
  const candidates = [
    user.id,
    identity.username,
    identity.email,
    identity.sub,
    identity.user_id,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return candidates.some((candidate) => devAdmins.includes(candidate));
}

function getUserScopes(user) {
  if (!user) return [];
  const payload = getTokenPayload(user);

  return [...new Set([
    ...normalizeArray(user.scopes),
    ...normalizeArray(user.scope),
    ...normalizeArray(user.attr?.scopes),
    ...normalizeArray(user.attr?.scope),
    ...normalizeArray(payload?.scope),
    ...(isDevAdminOverride(user) ? [
      'USER',
      'MANAGER',
      'ADMIN',
      'orders.read',
      'orders.write',
      'dashboard.read',
      'predictions.view',
      'analytics.read',
      'export.csv',
      'admin.users',
      'admin.roles',
      'admin.logs',
      'admin.sync',
      'admin.ml',
    ] : []),
  ])];
}

function hasRoleOrScope(user, expected) {
  if (!user) return false;
  if (typeof user.is === 'function' && user.is(expected)) return true;
  return getUserScopes(user).some((scope) => scopeMatches(scope, expected));
}

function hasAnyRoleScope(user, role) {
  return (ROLE_SCOPE_ALIASES[role] || [role]).some((scope) => hasRoleOrScope(user, scope));
}

function getEffectiveRole(user) {
  if (!user) return null;
  if (isDevAdminOverride(user)) return 'ADMIN';
  if (hasAnyRoleScope(user, 'ADMIN')) return 'ADMIN';
  if (hasAnyRoleScope(user, 'MANAGER')) return 'MANAGER';
  if (hasAnyRoleScope(user, 'USER')) return 'USER';
  return null;
}

function hasMinimumRole(user, requiredRole) {
  const effectiveRole = getEffectiveRole(user);
  return (ROLE_HIERARCHY[effectiveRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_SCOPE_ALIASES,
  scopeMatches,
  getTokenPayload,
  getConfiguredDevAdmins,
  isDevAdminOverride,
  getUserScopes,
  hasRoleOrScope,
  hasAnyRoleScope,
  getEffectiveRole,
  hasMinimumRole,
};
