'use strict';

const {
  decodeJwtPayload,
  getIdentityFromPayload,
  getIdentityFromUser,
} = require('../srv/utils/identity');

function jwtFromPayload(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('identity mapping', () => {
  test('decodes a JWT payload without validating or exposing the token', () => {
    const token = jwtFromPayload({
      name: 'Kaoutar Nadi',
      email: 'k.nadi@yaas.ma',
    });

    expect(decodeJwtPayload(token)).toMatchObject({
      name: 'Kaoutar Nadi',
      email: 'k.nadi@yaas.ma',
    });
  });

  test('uses JWT name claim before local or fallback fields', () => {
    const identity = getIdentityFromPayload({
      sub: 'abc-subject',
      user_id: 'idp-user-id',
      name: 'Kaoutar Nadi',
      given_name: 'Wrong',
      family_name: 'Local',
      user_name: 'k.nadi@yaas.ma',
      email: 'k.nadi@yaas.ma',
      scope: ['smartorder.USER'],
      groups: ['SmartOrder_User'],
      roles: ['USER'],
    });

    expect(identity.displayName).toBe('Kaoutar Nadi');
    expect(identity.username).toBe('k.nadi@yaas.ma');
    expect(identity.sub).toBe('abc-subject');
    expect(identity.user_id).toBe('idp-user-id');
    expect(identity.scopes).toEqual(['smartorder.USER']);
    expect(identity.groups).toEqual(['SmartOrder_User']);
    expect(identity.roles).toEqual(['USER']);
  });

  test('uses given_name and family_name when name is absent', () => {
    const identity = getIdentityFromPayload({
      given_name: 'Kaoutar',
      family_name: 'Nadi',
      preferred_username: 'k.nadi@yaas.ma',
    });

    expect(identity.displayName).toBe('Kaoutar Nadi');
  });

  test('extracts display name from CAP user tokenInfo payload', () => {
    const identity = getIdentityFromUser({
      id: 'k.nadi@yaas.ma',
      attr: {
        prenom: 'Khalid',
        nom: 'Nadi',
      },
      tokenInfo: {
        getPayload: () => ({
          name: 'Kaoutar Nadi',
          email: 'k.nadi@yaas.ma',
        }),
      },
    });

    expect(identity.displayName).toBe('Kaoutar Nadi');
    expect(identity.email).toBe('k.nadi@yaas.ma');
  });
});
