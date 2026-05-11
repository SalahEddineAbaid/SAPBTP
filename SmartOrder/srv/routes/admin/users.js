'use strict';
/**
 * Routes Admin — Gestion utilisateurs (UC12 + UC13)
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */
const express = require('express');
const cds = require('@sap/cds');
const { uuid } = cds.utils;

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
  if (!req.user?.is?.('ADMIN') && !req.user?.roles?.includes('ADMIN')) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}
router.use(requireAdmin);

// GET /api/admin/users
router.get('/', async (req, res, next) => {
  try {
    const db = await cds.connect.to('db');
    const users = await db.run(`
      SELECT ID, username, email, prenom, nom, role, actif,
             derniere_connexion, createdAt, updatedAt
      FROM smartorder_Utilisateurs
      ORDER BY role, username
    `);
    res.json({ items: users, total: users.length });
  } catch (err) { next(err); }
});

// POST /api/admin/users — Créer utilisateur
router.post('/', async (req, res, next) => {
  try {
    const { username, email, prenom, nom, role = 'USER', perimetre = {} } = req.body;
    if (!username || !email) {
      return res.status(400).json({ error: 'username et email sont requis.' });
    }
    const db = await cds.connect.to('db');
    const pg = isPostgres();
    const id = uuid();
    const now = new Date().toISOString();

    if (pg) {
      await db.run(`
        INSERT INTO smartorder_Utilisateurs
          (ID, username, email, prenom, nom, role, perimetre, actif, createdAt, updatedAt)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$8)
      `, [id, username, email, prenom || '', nom || '', role, JSON.stringify(perimetre), now]);
    } else {
      await db.run(`
        INSERT INTO smartorder_Utilisateurs
          (ID, username, email, prenom, nom, role, perimetre, actif, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,1,?,?)
      `, [id, username, email, prenom || '', nom || '', role, JSON.stringify(perimetre), now, now]);
    }

    const newUser = await db.run(
      pg
        ? `SELECT * FROM smartorder_Utilisateurs WHERE ID = $1`
        : `SELECT * FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );
    LOG.info('Utilisateur créé : %s (%s)', username, role);
    res.status(201).json(newUser[0]);
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

    if (prenom !== undefined) { updates.push(pg ? `prenom = $${idx++}` : 'prenom = ?');  params.push(prenom); }
    if (nom   !== undefined) { updates.push(pg ? `nom = $${idx++}`   : 'nom = ?');      params.push(nom); }
    if (email !== undefined) { updates.push(pg ? `email = $${idx++}` : 'email = ?');    params.push(email); }
    if (actif !== undefined) { updates.push(pg ? `actif = $${idx++}` : 'actif = ?');    params.push(actif ? (pg ? true : 1) : (pg ? false : 0)); }

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
    res.json(updated[0]);
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id/role — Modifier rôle + périmètre (UC13)
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
      `, [role, JSON.stringify(perimetre), new Date().toISOString(), id]);
    } else {
      await db.run(`
        UPDATE smartorder_Utilisateurs
        SET role = ?, perimetre = ?, updatedAt = ?
        WHERE ID = ?
      `, [role, JSON.stringify(perimetre), new Date().toISOString(), id]);
    }

    LOG.info('Rôle modifié : user=%s → %s par %s', id, role, currentUserId);
    const updated = await db.run(
      pg ? `SELECT * FROM smartorder_Utilisateurs WHERE ID = $1`
         : `SELECT * FROM smartorder_Utilisateurs WHERE ID = ?`,
      [id]
    );
    res.json(updated[0]);
  } catch (err) { next(err); }
});

module.exports = router;
