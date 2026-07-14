'use strict';

const express = require('express');
const cds = require('@sap/cds');
const { getIdentityFromUser } = require('../utils/identity');
const {
  csvFallbackEnabled,
  findUserFallback,
  isRecoverableDbError,
} = require('../utils/csvFallback');
const LOG = cds.log('profile-routes');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constantes de validation
// ---------------------------------------------------------------------------
const VALID_THEMES = ['light', 'dark', 'system'];
const VALID_LANGUAGES = ['FR', 'EN', 'AR'];
const VALID_DENSITIES = ['comfortable', 'compact'];
const VALID_DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const VALID_TIME_FORMATS = ['12h', '24h'];
const VALID_PAGINATIONS = [20, 50, 100];
const VALID_AUTO_REFRESH = [0, 30, 60, 300]; // 0 = manuel
const VALID_ALERT_TYPES = ['BLOQUE', 'RETARD', 'ANOMALIE_VOLUME', 'FOURNISSEUR_RISQUE'];
const VALID_DEPARTEMENTS = ['ACHATS', 'LOGISTIQUE', 'FINANCE', 'QUALITE', 'PRODUCTION', 'IT', 'AUTRE'];

const PHONE_REGEX = /^(\+\d{1,3}[- ]?)?\d{10}$/;

// ---------------------------------------------------------------------------
// Helper : Récupérer l'utilisateur depuis la BDD
// ---------------------------------------------------------------------------
async function getUserFromDB(userId) {
  const db = await cds.connect.to('db');
  const localUsername = typeof userId === 'string' && userId.includes('@')
    ? userId.split('@')[0]
    : userId;

  const user = await db.run(
    SELECT.one.from('smartorder.Utilisateurs').where({
      xsuaa_user_id: userId
    }).or({ username: userId })
      .or({ email: userId })
      .or({ username: localUsername })
  );

  if (!user) {
    throw new Error('Utilisateur introuvable');
  }

  // Parser les préférences JSON
  if (user.preferences && typeof user.preferences === 'string') {
    try {
      user.preferences = JSON.parse(user.preferences);
    } catch {
      user.preferences = null;
    }
  }

  // Parser le périmètre JSON
  if (user.perimetre && typeof user.perimetre === 'string') {
    try {
      user.perimetre = JSON.parse(user.perimetre);
    } catch {
      user.perimetre = null;
    }
  }

  // Masquer le xsuaa_user_id
  delete user.xsuaa_user_id;

  return user;
}

function applyAuthenticatedIdentity(user, req) {
  const identity = getIdentityFromUser(req.user);

  return {
    ...user,
    role: req.userRole || user.role || 'USER',
    username: identity.username || user.username,
    email: identity.email || user.email,
    displayName: identity.displayName,
    prenom: identity.given_name || user.prenom,
    nom: identity.family_name || user.nom,
    identitySource: identity.name
      ? 'jwt.name'
      : (identity.given_name || identity.family_name ? 'jwt.given_name_family_name' : 'local'),
  };
}

// ---------------------------------------------------------------------------
// Helper : Valider les préférences
// ---------------------------------------------------------------------------
function validatePreferences(prefs) {
  const errors = [];

  if (prefs.theme && !VALID_THEMES.includes(prefs.theme)) {
    errors.push(`Thème invalide. Valeurs autorisées : ${VALID_THEMES.join(', ')}`);
  }

  if (prefs.language && !VALID_LANGUAGES.includes(prefs.language)) {
    errors.push(`Langue invalide. Valeurs autorisées : ${VALID_LANGUAGES.join(', ')}`);
  }

  if (prefs.density && !VALID_DENSITIES.includes(prefs.density)) {
    errors.push(`Densité invalide. Valeurs autorisées : ${VALID_DENSITIES.join(', ')}`);
  }

  if (prefs.dateFormat && !VALID_DATE_FORMATS.includes(prefs.dateFormat)) {
    errors.push(`Format de date invalide. Valeurs autorisées : ${VALID_DATE_FORMATS.join(', ')}`);
  }

  if (prefs.timeFormat && !VALID_TIME_FORMATS.includes(prefs.timeFormat)) {
    errors.push(`Format d'heure invalide. Valeurs autorisées : ${VALID_TIME_FORMATS.join(', ')}`);
  }

  if (prefs.display?.pagination && !VALID_PAGINATIONS.includes(prefs.display.pagination)) {
    errors.push(`Pagination invalide. Valeurs autorisées : ${VALID_PAGINATIONS.join(', ')}`);
  }

  if (prefs.autoRefresh !== undefined && !VALID_AUTO_REFRESH.includes(prefs.autoRefresh)) {
    errors.push(`Auto-refresh invalide. Valeurs autorisées : ${VALID_AUTO_REFRESH.join(', ')}`);
  }

  if (prefs.notifications?.types) {
    const invalidTypes = prefs.notifications.types.filter(t => !VALID_ALERT_TYPES.includes(t));
    if (invalidTypes.length > 0) {
      errors.push(`Types d'alertes invalides : ${invalidTypes.join(', ')}`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// GET /api/profile — Lire le profil de l'utilisateur connecté
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = applyAuthenticatedIdentity(await getUserFromDB(userId), req);

    LOG.info('GET /api/profile — user=%s', userId);
    res.json(user);
  } catch (err) {
    LOG.error('Erreur GET /api/profile : %s', err.message);

    if (csvFallbackEnabled()) {
      const fallbackUser = findUserFallback(req.user.id);
      if (fallbackUser) {
        res.set('x-smartorder-data-source', 'csv-fallback');
        return res.json(applyAuthenticatedIdentity(fallbackUser, req));
      }
    }

    if (err.message === 'Utilisateur introuvable') {
      return res.status(404).json({ error: err.message });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/profile — Mettre à jour le profil
// ---------------------------------------------------------------------------
router.patch('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { prenom, nom, telephone, departement, avatar_url } = req.body;

    // Validation téléphone
    if (telephone && !PHONE_REGEX.test(telephone)) {
      return res.status(400).json({
        error: 'Format de téléphone invalide',
        message: 'Le téléphone doit contenir 10 chiffres, avec un indicatif international optionnel (+33, +212, etc.)'
      });
    }

    // Validation département
    if (departement && !VALID_DEPARTEMENTS.includes(departement)) {
      return res.status(400).json({
        error: 'Département invalide',
        message: `Départements autorisés : ${VALID_DEPARTEMENTS.join(', ')}`
      });
    }

    // Validation avatar_url (longueur max)
    if (avatar_url && avatar_url.length > 500) {
      return res.status(400).json({
        error: 'URL avatar trop longue',
        message: 'L\'URL de l\'avatar ne peut pas dépasser 500 caractères'
      });
    }

    const db = await cds.connect.to('db');
    const now = new Date().toISOString();

    // Construire l'objet de mise à jour (seulement les champs fournis)
    const updateData = { updatedAt: now };
    if (prenom !== undefined) updateData.prenom = prenom;
    if (nom !== undefined) updateData.nom = nom;
    if (telephone !== undefined) updateData.telephone = telephone;
    if (departement !== undefined) updateData.departement = departement;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    await db.run(
      UPDATE('smartorder.Utilisateurs')
        .set(updateData)
        .where({ xsuaa_user_id: userId }).or({ username: userId })
    );

    LOG.info('PATCH /api/profile — user=%s fields=%s', userId, Object.keys(updateData).join(','));

    // Retourner le profil mis à jour
    const updatedUser = applyAuthenticatedIdentity(await getUserFromDB(userId), req);
    res.json(updatedUser);
  } catch (err) {
    LOG.error('Erreur PATCH /api/profile : %s', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/profile/preferences — Mettre à jour les préférences
// ---------------------------------------------------------------------------
router.patch('/preferences', async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;

    // Validation des préférences
    const errors = validatePreferences(preferences);
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Préférences invalides',
        details: errors
      });
    }

    const db = await cds.connect.to('db');
    const now = new Date().toISOString();

    // Sérialiser les préférences en JSON
    const preferencesJSON = JSON.stringify(preferences);

    await db.run(
      UPDATE('smartorder.Utilisateurs')
        .set({ preferences: preferencesJSON, updatedAt: now })
        .where({ xsuaa_user_id: userId }).or({ username: userId })
    );

    LOG.info('PATCH /api/profile/preferences — user=%s', userId);

    // Retourner le profil mis à jour
    const updatedUser = applyAuthenticatedIdentity(await getUserFromDB(userId), req);
    res.json(updatedUser);
  } catch (err) {
    LOG.error('Erreur PATCH /api/profile/preferences : %s', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
