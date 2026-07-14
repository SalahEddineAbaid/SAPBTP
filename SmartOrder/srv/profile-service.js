'use strict';

const cds = require('@sap/cds');
const { getIdentityFromUser } = require('./utils/identity');
const LOG = cds.log('profile-service');

module.exports = class ProfileService extends cds.ApplicationService {
  async init() {

    // ------------------------------------------------------------------
    // BEFORE READ — Filtrer automatiquement par utilisateur connecté
    // ------------------------------------------------------------------
    this.before('READ', 'MonProfil', async (req) => {
      if (!req.user) {
        throw new cds.error('Non authentifié', { status: 401 });
      }

      const userId = req.user.id;

      // Forcer le filtre sur l'utilisateur connecté (sécurité)
      // Un utilisateur ne peut lire QUE son propre profil
      const userFilter = {
        xor: [
          { xsuaa_user_id: userId },
          { username: userId }
        ]
      };

      if (!req.query.SELECT.where) {
        req.query.SELECT.where = [userFilter];
      } else {
        req.query.SELECT.where = [
          userFilter,
          'and',
          '(',
          ...req.query.SELECT.where,
          ')'
        ];
      }

      LOG.debug('READ MonProfil — user=%s', userId);
    });

    // ------------------------------------------------------------------
    // AFTER READ — Parser les préférences JSON, fusionner identité JWT,
    // et masquer champs sensibles
    // ------------------------------------------------------------------
    this.after('READ', 'MonProfil', async (users, req) => {
      if (!users) return;

      const userList = Array.isArray(users) ? users : [users];

      for (const user of userList) {
        // Parser les préférences JSON
        if (user.preferences && typeof user.preferences === 'string') {
          try {
            user.preferences = JSON.parse(user.preferences);
          } catch (err) {
            LOG.warn('Erreur parsing preferences pour user %s : %s', user.ID, err.message);
            user.preferences = null;
          }
        }

        // Parser le périmètre JSON (MANAGER)
        if (user.perimetre && typeof user.perimetre === 'string') {
          try {
            user.perimetre = JSON.parse(user.perimetre);
          } catch (err) {
            LOG.warn('Erreur parsing perimetre pour user %s : %s', user.ID, err.message);
            user.perimetre = null;
          }
        }

        // Fusionner les données d'identité depuis le payload JWT
        // pour que le profil affiche les informations exactes (nom, email, etc.)
        // même si la base de données contient des données partielles/obsolètes.
        try {
          const identity = getIdentityFromUser(req.user);
          user.username = identity.username || user.username;
          user.email = identity.email || user.email;
          user.displayName = identity.displayName;
          user.prenom = identity.given_name || user.prenom;
          user.nom = identity.family_name || user.nom;
          user.identitySource = identity.name
            ? 'jwt.name'
            : (identity.given_name || identity.family_name ? 'jwt.given_name_family_name' : 'local');
        } catch (err) {
          LOG.warn('Impossible de fusionner l\'identité JWT pour le profil : %s', err.message);
        }

        // Masquer le xsuaa_user_id (déjà exclu dans la projection CDS, mais double sécurité)
        delete user.xsuaa_user_id;
      }

      return Array.isArray(users) ? userList : userList[0];
    });

    await super.init();
    LOG.info('✅ ProfileService CAP initialisé');
  }
};
