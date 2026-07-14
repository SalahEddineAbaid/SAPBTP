'use strict';

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function decodeJwtPayload(token) {
  if (!token || !token.includes('.')) return {};

  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function cleanText(value) {
  if (!value) return '';
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value).trim();
}

function getIdentityFromPayload(payload = {}) {
  const email = cleanText(payload.email || payload.mail);
  const username = cleanText(
    payload.user_name
    || payload.preferred_username
    || email
    || payload.sub
  );
  const fullName = cleanText(payload.name);
  const givenName = cleanText(payload.given_name);
  const familyName = cleanText(payload.family_name);
  const composedName = [givenName, familyName].filter(Boolean).join(' ').trim();
  const displayName = fullName || composedName || username || email || 'xsuaa-user';

  return {
    username: username || 'xsuaa-user',
    email,
    sub: cleanText(payload.sub),
    user_id: cleanText(payload.user_id || payload.userId),
    name: fullName,
    given_name: givenName,
    family_name: familyName,
    displayName,
    scopes: normalizeArray(payload.scope),
    groups: normalizeArray(payload.groups),
    roles: normalizeArray(payload.roles),
  };
}

function getIdentityFromUser(user = {}) {
  const payload = typeof user?.tokenInfo?.getPayload === 'function'
    ? user.tokenInfo.getPayload()
    : (user.jwt || user._?.jwt || {});
  const fromPayload = getIdentityFromPayload(payload);
  const attr = user.attr || {};
  const name = cleanText(attr.name || attr.displayName || fromPayload.name);
  const givenName = cleanText(attr.given_name || attr.prenom || fromPayload.given_name);
  const familyName = cleanText(attr.family_name || attr.nom || fromPayload.family_name);
  const composedName = [givenName, familyName].filter(Boolean).join(' ').trim();
  const username = cleanText(attr.username || user.id || fromPayload.username);
  const email = cleanText(attr.email || attr.mail || fromPayload.email);

  return {
    username: username || email || 'xsuaa-user',
    email,
    sub: fromPayload.sub,
    user_id: fromPayload.user_id,
    name,
    given_name: givenName,
    family_name: familyName,
    displayName: name || composedName || username || email || 'xsuaa-user',
    scopes: [...new Set([
      ...normalizeArray(user.scopes),
      ...normalizeArray(user.scope),
      ...normalizeArray(attr.scopes),
      ...normalizeArray(attr.scope),
      ...fromPayload.scopes,
    ])],
    groups: [...new Set([
      ...normalizeArray(user.groups),
      ...normalizeArray(attr.groups),
      ...fromPayload.groups,
    ])],
    roles: [...new Set([
      ...normalizeArray(user.roles),
      ...normalizeArray(attr.roles),
      ...fromPayload.roles,
    ])],
  };
}

module.exports = {
  normalizeArray,
  decodeJwtPayload,
  getIdentityFromPayload,
  getIdentityFromUser,
};
