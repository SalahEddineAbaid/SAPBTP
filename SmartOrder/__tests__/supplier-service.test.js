'use strict';

const {
  buildSupplierMetrics,
  normalizeCountryCode,
} = require('../srv/services/supplierService');

describe('supplierService', () => {
  test('normalise les codes pays SAP/legacy pour affichage SmartOrder', () => {
    expect(normalizeCountryCode('MAR')).toBe('MA');
    expect(normalizeCountryCode('fra')).toBe('FR');
    expect(normalizeCountryCode('MA')).toBe('MA');
  });

  test('calcule les metriques fournisseur depuis les commandes locales', () => {
    const supplier = {
      taux_retard_moyen: 0,
      delai_moyen_jours: 0,
    };
    const orders = [
      {
        statut: 'LIVRE',
        date_commande: '2026-06-01',
        date_previsionnelle: '2026-06-05',
        date_livraison_reelle: '2026-06-04',
        postes_en_retard: 0,
      },
      {
        statut: 'EN_COURS',
        date_commande: '2026-06-01',
        date_previsionnelle: '2026-06-01',
        date_livraison_reelle: null,
        postes_en_retard: 1,
      },
      {
        statut: 'ANNULE',
        date_commande: '2026-06-01',
        date_previsionnelle: '2026-06-01',
        date_livraison_reelle: null,
        postes_en_retard: 1,
      },
    ];

    const metrics = buildSupplierMetrics(supplier, orders);

    expect(metrics.nombre_commandes).toBe(3);
    expect(metrics.commandes_actives).toBe(2);
    expect(metrics.commandes_en_retard).toBe(1);
    expect(metrics.commandes_livrees).toBe(1);
    expect(metrics.taux_retard_moyen).toBe(0.5);
    expect(metrics.score_performance).toBe(0.5);
    expect(metrics.delai_moyen_jours).toBe(3);
  });
});
