'use strict';
/**
 * Routes Admin — Gestion utilisateurs (UC12 + UC13)
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */
const express = require('express');
const cds = require('@sap/cds');
const { uuid } = cds.utils;
const {
  csvFallbackEnabled,
  isRecoverableDbError,
  readUsersFallback,
} = require('../../utils/csvFallback');

const router = express.Router();
const LOG = cds.log('admin-users');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

// Génère un placeholder paramétré ($1 en PG, ? en SQLite)
function ph(idx) { return isPostgres() ? `$${idx}` : '?'; }

function requireAdmin(req, res, next) {
  if (req.userRole === 'ADMIN' || req.user?.is?.('ADMIN') || req.user?.roles?.includes('ADMIN')) {
    return next();
  }

  const scopes = [
    ...(Array.isArray(req.user?.scopes) ? req.user.scopes : []),
    ...(Array.isArray(req.user?.scope) ? req.user.scope : []),
  ];
  if (scopes.some((scope) => scope === 'ADMIN' || scope.endsWith('.ADMIN') || scope.endsWith('.admin.users'))) {
    return next();
  }

  return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
}
function parsePerimetre(value) {
  if (!value) return { company_codes: [], purchasing_orgs: [] };
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return {
      company_codes: Array.isArray(parsed.company_codes) ? parsed.company_codes : [],
      purchasing_orgs: Array.isArray(parsed.purchasing_orgs) ? parsed.purchasing_orgs : [],
    };
  } catch {
    return { company_codes: [], purchasing_orgs: [] };
  }
}

function normalizeUser(user) {
  if (!user) return user;
  return {
    ...user,
    actif: user.actif === true || user.actif === 1,
    perimetre: parsePerimetre(user.perimetre),
  };
}

router.use(requireAdmin);

// GET /api/admin/users
router.get('/', async (req, res, next) => {
  try {
    const db = await cds.connect.to('db');
    const users = await db.run(`
      SELECT ID, username, email, prenom, nom, role, perimetre, actif,
             derniere_connexion, createdAt, updatedAt
      FROM smartorder_Utilisateurs
      ORDER BY role, username
    `);
    const items = users.map(normalizeUser);
    res.json({ items, total: items.length });
  } catch (err) {
    LOG.warn('Fallback utilisateurs : %s', err.message);
    if (csvFallbackEnabled()) {
      const top = Math.min(Math.max(Number(req.query.top || 200), 1), 500);
      const skip = Math.max(Number(req.query.skip || 0), 0);
      res.set('x-smartorder-data-source', 'csv-fallback');
      return res.json(readUsersFallback({ top, skip }));
    }
    next(err);
  }
});

// POST /api/admin/users — Créer utilisateur
router.post('/', async (req, res, next) => {
  try {
    const { username, email, prenom, nom, role = 'USER', perimetre = {}, actif = true } = req.body;
    const ROLES = ['USER', 'MANAGER', 'ADMIN'];
    if (!username || !email) {
      return res.status(400).json({ error: 'username et email sont requis.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `RÃ´le invalide. Valeurs : ${ROLES.join(', ')}` });
    }
    const db = await cds.connect.to('db');
    const pg = isPostgres();
    const id = uuid();
    const now = new Date().toISOString();

    if (pg) {
      await db.run(`
        INSERT INTO smartorder_Utilisateurs
          (ID, username, email, prenom, nom, role, perimetre, actif, createdAt, updatedAt)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      `, [id, username, email, prenom || '', nom || '', role, JSON.stringify(parsePerimetre(perimetre)), Boolean(actif), now]);
    } else {
      await db.run(`
        INSERT INTO smartorder_Utilisateurs
          (ID, username, email, prenom, nom, role, perimetre, actif, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, [id, username, email, prenom || '', nom || '', role, JSON.stringify(parsePerimetre(perimetre)), actif ? 1 : 0, now, now]);
    }

    const newUser = await db.run(
      pg
        ? `SELECT * FROM smartorder_Utilisateurs WHERE ID = $1`
        : `SELECT * FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );
    LOG.info('Utilisateur créé : %s (%s)', username, role);
    res.status(201).json(normalizeUser(newUser[0]));
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id — Modifier utilisateur
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { prenom, nom, email, actif } = req.body;
    const db = await cds.connect.to('db');
    const pg = isPostgres();

    const updates = [];
    const params = [];
    let idx = 1;

    if (prenom !== undefined) { updates.push(pg ? `prenom = $${idx++}` : 'prenom = ?'); params.push(prenom); }
    if (nom !== undefined) { updates.push(pg ? `nom = $${idx++}` : 'nom = ?'); params.push(nom); }
    if (email !== undefined) { updates.push(pg ? `email = $${idx++}` : 'email = ?'); params.push(email); }
    if (actif !== undefined) { updates.push(pg ? `actif = $${idx++}` : 'actif = ?'); params.push(actif ? (pg ? true : 1) : (pg ? false : 0)); }

    updates.push(pg ? `updatedAt = $${idx++}` : 'updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await db.run(
      `UPDATE smartorder_Utilisateurs SET ${updates.join(', ')} WHERE ID = ${pg ? `$${idx}` : '?'}`,
      params
    );
    const updated = await db.run(
      pg ? `SELECT * FROM smartorder_Utilisateurs WHERE ID = $1`
        : `SELECT * FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );
    if (!updated[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json(normalizeUser(updated[0]));
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id/role — Modifier rôle + périmètre (UC13)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await cds.connect.to('db');
    const pg = isPostgres();

    const existing = await db.run(
      pg ? `SELECT ID, username, xsuaa_user_id FROM smartorder_Utilisateurs WHERE ID = $1`
        : `SELECT ID, username, xsuaa_user_id FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );

    const user = existing[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const currentUserId = req.user?.id;
    if ([user.ID, user.username, user.xsuaa_user_id].includes(currentUserId)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    if (pg) {
      await db.run(`UPDATE smartorder_Orders SET manager_ID = NULL WHERE manager_ID = $1`, [id]);
      await db.run(`UPDATE smartorder_HistoriqueStatut SET user_ID = NULL WHERE user_ID = $1`, [id]);
      await db.run(`DELETE FROM smartorder_Utilisateurs WHERE ID = $1`, [id]);
    } else {
      await db.run(`UPDATE smartorder_Orders SET manager_ID = NULL WHERE manager_ID = ?`, [id]);
      await db.run(`UPDATE smartorder_HistoriqueStatut SET user_ID = NULL WHERE user_ID = ?`, [id]);
      await db.run(`DELETE FROM smartorder_Utilisateurs WHERE ID = ?`, [id]);
    }

    LOG.info('Utilisateur supprime : %s (%s) par %s', user.username, id, currentUserId);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.patch('/:id/role', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, perimetre = {} } = req.body;
    const ROLES = ['USER', 'MANAGER', 'ADMIN'];
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `Rôle invalide. Valeurs : ${ROLES.join(', ')}` });
    }
    const currentUserId = req.user?.id;
    if (currentUserId === id && role !== 'ADMIN') {
      return res.status(403).json({ error: 'Vous ne pouvez pas rétrograder votre propre rôle ADMIN.' });
    }
    const db = await cds.connect.to('db');
    const pg = isPostgres();

    if (pg) {
      await db.run(`
        UPDATE smartorder_Utilisateurs
        SET role = $1, perimetre = $2, updatedAt = $3
        WHERE ID = $4
      `, [role, JSON.stringify(parsePerimetre(perimetre)), new Date().toISOString(), id]);
    } else {
      await db.run(`
        UPDATE smartorder_Utilisateurs
        SET role = ?, perimetre = ?, updatedAt = ?
        WHERE ID = ?
      `, [role, JSON.stringify(parsePerimetre(perimetre)), new Date().toISOString(), id]);
    }

    LOG.info('Rôle modifié : user=%s → %s par %s', id, role, currentUserId);
    const updated = await db.run(
      pg ? `SELECT * FROM smartorder_Utilisateurs WHERE ID = $1`
        : `SELECT * FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );
    if (!updated[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json(normalizeUser(updated[0]));
  } catch (err) { next(err); }
});

module.exports = router;
