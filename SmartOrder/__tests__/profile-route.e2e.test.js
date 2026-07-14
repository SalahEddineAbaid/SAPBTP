'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('@sap/cds', () => ({
  log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  connect: {
    to: jest.fn(),
  },
}));

const cds = require('@sap/cds');

function installSelectMock() {
  const query = {
    where: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
  };

  global.SELECT = {
    one: {
      from: jest.fn(() => query),
    },
  };

  return query;
}

describe('profile route identity flow', () => {
  beforeEach(() => {
    installSelectMock();
    cds.connect.to.mockReset();
  });

  afterEach(() => {
    delete global.SELECT;
    jest.resetModules();
  });

  test('GET /api/profile returns JWT display name before local database name', async () => {
    cds.connect.to.mockResolvedValue({
      run: jest.fn().mockResolvedValue({
        ID: 'u1000001-0001-0001-0001-000000000002',
        username: 'k.nadi',
        email: 'k.nadi@yaas.ma',
        prenom: 'Khalid',
        nom: 'Nadi',
        role: 'USER',
        actif: true,
        preferences: '{}',
      }),
    });

    const profileRouter = require('../srv/routes/profile');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: 'k.nadi@yaas.ma',
        tokenInfo: {
          getPayload: () => ({
            name: 'Kaoutar Nadi',
            given_name: 'Kaoutar',
            family_name: 'Nadi',
            email: 'k.nadi@yaas.ma',
          }),
        },
      };
      next();
    });
    app.use('/api/profile', profileRouter);

    const res = await request(app).get('/api/profile').expect(200);

    expect(res.body).toMatchObject({
      username: 'k.nadi@yaas.ma',
      email: 'k.nadi@yaas.ma',
      displayName: 'Kaoutar Nadi',
      prenom: 'Kaoutar',
      nom: 'Nadi',
      identitySource: 'jwt.name',
    });
    expect(res.body.prenom).not.toBe('Khalid');
  });
});
