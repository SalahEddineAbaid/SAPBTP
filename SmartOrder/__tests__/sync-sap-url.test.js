'use strict';

const {
  buildPurchaseOrderUrl,
  mapSAPItemsToCDS,
  normalizeSapRelativeUrl,
  toODataDateTimeOffset,
} = require('../srv/services/syncSAPService');

describe('syncSAPService OData URL handling', () => {
  test('formats PostgreSQL Date values as OData V4 DateTimeOffset literals', () => {
    const value = toODataDateTimeOffset(new Date('2025-05-18T06:00:18.123Z'));

    expect(value).toBe('2025-05-18T06:00:18Z');
    expect(value).not.toContain('GMT');
    expect(value).not.toContain('Sun ');
  });

  test('builds an encoded DELTA URL accepted by SAP Gateway', () => {
    const url = buildPurchaseOrderUrl({
      mode: 'DELTA',
      lastSyncDate: new Date('2025-05-18T06:00:18Z'),
      pageSize: 100,
    });

    expect(url).toContain('/PurchaseOrder?');
    expect(url).toContain('$expand=_PurchaseOrderItem%2C_SupplierAddress');
    expect(url).toContain('$top=100');
    expect(url).toContain('$filter=LastChangeDateTime%20gt%202025-05-18T06%3A00%3A18Z');
    expect(url).not.toContain('GMT');
  });

  test('normalizes absolute SAP next links before passing them to CAP remote service', () => {
    const next = normalizeSapRelativeUrl(
      'https://my422081-api.s4hana.cloud.sap/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder?$skiptoken=abc'
    );

    expect(next).toBe('/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder?$skiptoken=abc');
  });

  test('maps S/4HANA item values without exceeding local PostgreSQL field sizes', () => {
    const { lignes, errors } = mapSAPItemsToCDS([
      {
        PurchaseOrderItem: '10',
        Material: '3000048',
        PurchaseOrderItemText: 'ARTICLE TEST 1 avec designation SAP plus longue que le CSV initial',
        MaterialGroup: 'ZPFDND',
        Plant: 'S004',
        OrderQuantity: '55',
        NetPriceAmount: '66.00',
        OrderPriceUnit: 'KGM',
      },
    ]);

    expect(errors).toEqual([]);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].unite).toBe('KGM');
    expect(lignes[0].categorie_article).toBe('ZPFDND');
    expect(lignes[0].designation_produit.length).toBeLessThanOrEqual(80);
  });
});
