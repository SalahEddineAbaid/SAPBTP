# Mapping Détaillé : Champs SAP ↔ Schéma CDS

## Document de Référence

- **API SAP** : `API_PURCHASEORDER_PROCESS_SRV`
- **Version** : S/4HANA Cloud 2024
- **Date de validation** : À compléter après revue avec encadrant

---

## 1. Mapping : Orders (A_PurchaseOrder)

### 1.1 Champs d'identification

| Champ SAP                    | Type SAP       | Champ CDS       | Type CDS            | Obligatoire | Notes            |
| ---------------------------- | -------------- | --------------- | ------------------- | ----------- | ---------------- |
| `PurchaseOrder`              | Edm.String(10) | `numero_sap`    | String(10)          | ✅ Oui      | Clé primaire SAP |
| `PurchaseOrderType`          | Edm.String(4)  | `type_commande` | TypeCommandeSAPEnum | ✅ Oui      | NB, UB, KB, etc. |
| `PurchasingProcessingStatus` | Edm.String(2)  | `statut_sap`    | StatutSAPEnum       | ✅ Oui      | 01-09            |

### 1.2 Champs organisationnels (CRITIQUES)

| Champ SAP                | Type SAP      | Champ CDS                 | Type CDS  | Obligatoire     | Notes                      |
| ------------------------ | ------------- | ------------------------- | --------- | --------------- | -------------------------- |
| `CompanyCode`            | Edm.String(4) | `company_code`            | String(4) | ✅ Oui          | Code société (ex: 1000)    |
| `PurchasingOrganization` | Edm.String(4) | `purchasing_organization` | String(4) | ✅ Oui          | Org. d'achat (ex: 1010)    |
| `PurchasingGroup`        | Edm.String(3) | `purchasing_group`        | String(3) | ✅ Oui          | Groupe acheteurs (ex: 001) |
| `Plant`                  | Edm.String(4) | `plant`                   | String(4) | ⚠️ Conditionnel | Site/usine                 |

### 1.3 Champs commerciaux

| Champ SAP                 | Type SAP       | Champ CDS              | Type CDS     | Obligatoire | Notes               |
| ------------------------- | -------------- | ---------------------- | ------------ | ----------- | ------------------- |
| `Supplier`                | Edm.String(10) | `fournisseur.code_sap` | String(10)   | ✅ Oui      | Clé étrangère       |
| `DocumentCurrency`        | Edm.String(5)  | `devise`               | String(5)    | ✅ Oui      | EUR, USD, MAD, etc. |
| `ExchangeRate`            | Edm.Decimal    | `taux_change`          | Decimal(9,5) | ❌ Non      | Défaut: 1           |
| `PaymentTerms`            | Edm.String(4)  | `conditions_paiement`  | String(4)    | ❌ Non      | Ex: Z001, Z030      |
| `IncotermsClassification` | Edm.String(3)  | `incoterms`            | String(3)    | ❌ Non      | EXW, FOB, CIF, etc. |
| `IncotermsLocation`       | Edm.String(70) | `incoterms_lieu`       | String(70)   | ❌ Non      | Lieu Incoterms      |

### 1.4 Champs de dates

| Champ SAP            | Type SAP     | Champ CDS           | Type CDS | Obligatoire | Notes                 |
| -------------------- | ------------ | ------------------- | -------- | ----------- | --------------------- |
| `DocumentDate`       | Edm.DateTime | `date_document`     | Date     | ✅ Oui      | Date du document      |
| `CreationDate`       | Edm.DateTime | `date_creation`     | DateTime | ✅ Oui      | Date de création      |
| `PurchaseOrderDate`  | Edm.DateTime | `date_commande`     | Date     | ✅ Oui      | Date de la commande   |
| `LastChangeDateTime` | Edm.DateTime | `date_modification` | DateTime | ❌ Non      | Dernière modification |

### 1.5 Champs de workflow

| Champ SAP                  | Type SAP      | Champ CDS             | Type CDS  | Obligatoire | Notes                        |
| -------------------------- | ------------- | --------------------- | --------- | ----------- | ---------------------------- |
| `ReleaseIsNotCompleted`    | Edm.Boolean   | `deblocage_incomplet` | Boolean   | ❌ Non      | true = en attente déblocage  |
| `PurchasingDocumentOrigin` | Edm.String(1) | `origine_document`    | String(1) | ❌ Non      | Origine (manuel, auto, etc.) |

### 1.6 Champs custom SmartOrder (non SAP)

| Champ CDS           | Type CDS      | Source  | Notes                 |
| ------------------- | ------------- | ------- | --------------------- |
| `urgence`           | UrgenceEnum   | Custom  | Calculé par ML        |
| `categorie_article` | String(50)    | Custom  | Catégorisation métier |
| `score_priorite`    | Double        | Custom  | Score ML              |
| `montant_total`     | Decimal(15,2) | Calculé | Somme des lignes      |

---

## 2. Mapping : LignesCommande (A_PurchaseOrderItem)

### 2.1 Champs d'identification

| Champ SAP           | Type SAP       | Champ CDS             | Type CDS   | Obligatoire | Notes              |
| ------------------- | -------------- | --------------------- | ---------- | ----------- | ------------------ |
| `PurchaseOrder`     | Edm.String(10) | `commande.numero_sap` | String(10) | ✅ Oui      | Clé étrangère      |
| `PurchaseOrderItem` | Edm.String(5)  | `numero_poste`        | String(5)  | ✅ Oui      | 00010, 00020, etc. |

### 2.2 Champs produit

| Champ SAP               | Type SAP       | Champ CDS             | Type CDS   | Obligatoire | Notes              |
| ----------------------- | -------------- | --------------------- | ---------- | ----------- | ------------------ |
| `Material`              | Edm.String(40) | `code_produit`        | String(40) | ✅ Oui      | Code article       |
| `PurchaseOrderItemText` | Edm.String(40) | `designation_produit` | String(40) | ❌ Non      | Description courte |
| `MaterialGroup`         | Edm.String(9)  | `material_group`      | String(9)  | ❌ Non      | Groupe d'articles  |

### 2.3 Champs quantités et prix

| Champ SAP        | Type SAP          | Champ CDS            | Type CDS      | Obligatoire | Notes               |
| ---------------- | ----------------- | -------------------- | ------------- | ----------- | ------------------- |
| `OrderQuantity`  | Edm.Decimal(13,3) | `quantite_commandee` | Decimal(13,3) | ✅ Oui      | Quantité            |
| `OrderPriceUnit` | Edm.String(3)     | `unite_commande`     | String(3)     | ✅ Oui      | PC, KG, L, etc.     |
| `NetPriceAmount` | Edm.Decimal(11,2) | `prix_unitaire`      | Decimal(11,2) | ✅ Oui      | Prix unitaire net   |
| `NetAmount`      | Edm.Decimal(14,3) | `montant_net`        | Decimal(14,3) | ❌ Non      | Calculé: Qté × Prix |

### 2.4 Champs organisationnels

| Champ SAP         | Type SAP      | Champ CDS          | Type CDS  | Obligatoire     | Notes                |
| ----------------- | ------------- | ------------------ | --------- | --------------- | -------------------- |
| `Plant`           | Edm.String(4) | `plant`            | String(4) | ⚠️ Conditionnel | Site de livraison    |
| `StorageLocation` | Edm.String(4) | `storage_location` | String(4) | ❌ Non          | Emplacement stockage |

### 2.5 Champs fiscaux

| Champ SAP | Type SAP      | Champ CDS  | Type CDS  | Obligatoire | Notes    |
| --------- | ------------- | ---------- | --------- | ----------- | -------- |
| `TaxCode` | Edm.String(2) | `tax_code` | String(2) | ❌ Non      | Code TVA |

### 2.6 Champs de dates

| Champ SAP                  | Type SAP     | Champ CDS               | Type CDS | Obligatoire | Notes                    |
| -------------------------- | ------------ | ----------------------- | -------- | ----------- | ------------------------ |
| `ScheduleLineDeliveryDate` | Edm.DateTime | `date_livraison_prevue` | Date     | ❌ Non      | Date de livraison prévue |

---

## 3. Mapping : Fournisseurs (API_BUSINESS_PARTNER)

### 3.1 Champs d'identification

| Champ SAP              | Type SAP        | Champ CDS       | Type CDS    | Obligatoire | Notes             |
| ---------------------- | --------------- | --------------- | ----------- | ----------- | ----------------- |
| `Supplier`             | Edm.String(10)  | `code_sap`      | String(10)  | ✅ Oui      | Clé primaire      |
| `SupplierName`         | Edm.String(80)  | `nom`           | String(80)  | ✅ Oui      | Nom court         |
| `SupplierFullName`     | Edm.String(220) | `nom_complet`   | String(220) | ❌ Non      | Nom complet       |
| `SupplierAccountGroup` | Edm.String(4)   | `groupe_compte` | String(4)   | ❌ Non      | Groupe de comptes |

### 3.2 Champs d'adresse

| Champ SAP    | Type SAP       | Champ CDS     | Type CDS   | Obligatoire | Notes                     |
| ------------ | -------------- | ------------- | ---------- | ----------- | ------------------------- |
| `Country`    | Edm.String(3)  | `pays`        | String(3)  | ✅ Oui      | Code ISO (MAR, FRA, etc.) |
| `Region`     | Edm.String(3)  | `region`      | String(3)  | ❌ Non      | Région/Province           |
| `CityName`   | Edm.String(40) | `ville`       | String(40) | ❌ Non      | Ville                     |
| `PostalCode` | Edm.String(10) | `code_postal` | String(10) | ❌ Non      | Code postal               |
| `StreetName` | Edm.String(60) | `rue`         | String(60) | ❌ Non      | Rue                       |

### 3.3 Champs de contact

| Champ SAP      | Type SAP        | Champ CDS   | Type CDS    | Obligatoire | Notes     |
| -------------- | --------------- | ----------- | ----------- | ----------- | --------- |
| `EmailAddress` | Edm.String(241) | `email`     | String(241) | ❌ Non      | Email     |
| `PhoneNumber`  | Edm.String(30)  | `telephone` | String(30)  | ❌ Non      | Téléphone |
| `FaxNumber`    | Edm.String(30)  | `fax`       | String(30)  | ❌ Non      | Fax       |

### 3.4 Champs fiscaux

| Champ SAP         | Type SAP       | Champ CDS       | Type CDS   | Obligatoire | Notes                     |
| ----------------- | -------------- | --------------- | ---------- | ----------- | ------------------------- |
| `VATRegistration` | Edm.String(20) | `numero_tva`    | String(20) | ❌ Non      | N° TVA intracommunautaire |
| `TaxNumber`       | Edm.String(20) | `numero_fiscal` | String(20) | ❌ Non      | N° identification fiscale |

### 3.5 Champs commerciaux

| Champ SAP      | Type SAP      | Champ CDS             | Type CDS  | Obligatoire | Notes                  |
| -------------- | ------------- | --------------------- | --------- | ----------- | ---------------------- |
| `Currency`     | Edm.String(5) | `devise`              | String(5) | ❌ Non      | Devise par défaut      |
| `PaymentTerms` | Edm.String(4) | `conditions_paiement` | String(4) | ❌ Non      | Conditions de paiement |

### 3.6 Champs custom SmartOrder (Analytics/ML)

| Champ CDS                | Type CDS      | Source  | Notes                      |
| ------------------------ | ------------- | ------- | -------------------------- |
| `taux_retard_moyen`      | Double        | Calculé | % de retard moyen          |
| `delai_moyen_jours`      | Double        | Calculé | Délai moyen de livraison   |
| `score_performance`      | Double        | ML      | Score de performance (0-1) |
| `nombre_commandes_total` | Integer       | Calculé | Nombre total de commandes  |
| `montant_total_achats`   | Decimal(15,2) | Calculé | Montant total des achats   |

---

## 4. Codes et Valeurs de Référence SAP

### 4.1 Types de commandes (PurchaseOrderType)

| Code | Description             | Utilisation              |
| ---- | ----------------------- | ------------------------ |
| `NB` | Standard Purchase Order | Commande standard        |
| `UB` | Stock Transfer Order    | Transfert de stock       |
| `KB` | Consignment Order       | Commande en consignation |
| `LP` | Subcontracting Order    | Sous-traitance           |
| `FO` | Framework Order         | Commande cadre           |

### 4.2 Statuts de traitement (PurchasingProcessingStatus)

| Code | Description          | Mapping SmartOrder |
| ---- | -------------------- | ------------------ |
| `01` | En cours de création | EN_CREATION        |
| `02` | Approuvé             | APPROUVE           |
| `03` | En commande          | EN_COMMANDE        |
| `04` | Confirmé             | CONFIRME           |
| `05` | Partiellement livré  | PARTIELLEMENT      |
| `06` | Livré                | LIVRE              |
| `07` | Facturé              | FACTURE            |
| `08` | Annulé               | ANNULE             |
| `09` | Bloqué               | BLOQUE             |

### 4.3 Incoterms standards

| Code  | Description                    |
| ----- | ------------------------------ |
| `EXW` | Ex Works                       |
| `FCA` | Free Carrier                   |
| `CPT` | Carriage Paid To               |
| `CIP` | Carriage and Insurance Paid To |
| `DAP` | Delivered At Place             |
| `DPU` | Delivered at Place Unloaded    |
| `DDP` | Delivered Duty Paid            |
| `FAS` | Free Alongside Ship            |
| `FOB` | Free On Board                  |
| `CFR` | Cost and Freight               |
| `CIF` | Cost, Insurance and Freight    |

---

## 5. Règles de Transformation des Données

### 5.1 Conversion des statuts

```javascript
// Mapping ancien schéma → nouveau schéma SAP
const statusMapping = {
  EN_ATTENTE: "01", // EN_CREATION
  EN_COURS: "03", // EN_COMMANDE
  EN_LIVRAISON: "05", // PARTIELLEMENT
  LIVRE: "06", // LIVRE
  ANNULE: "08", // ANNULE
  BLOQUE: "09", // BLOQUE
};
```

### 5.2 Format des numéros de poste

```javascript
// SAP utilise des numéros de poste avec zéros à gauche
// Exemple: 1 → '00010', 2 → '00020'
function formatNumeroPoste(numero) {
  return String(numero * 10).padStart(5, "0");
}
```

### 5.3 Calcul du montant total

```javascript
// Le montant total de la commande est la somme des lignes
function calculerMontantTotal(lignes) {
  return lignes.reduce((total, ligne) => {
    return total + ligne.quantite_commandee * ligne.prix_unitaire;
  }, 0);
}
```

---

## 6. Champs Obligatoires par Contexte

### 6.1 Création d'une commande (minimum requis)

```
✅ OBLIGATOIRES:
- numero_sap
- type_commande
- statut_sap
- company_code
- purchasing_organization
- purchasing_group
- fournisseur (code_sap)
- devise
- date_document
- date_creation
- date_commande
- Au moins 1 ligne de commande avec:
  - numero_poste
  - code_produit
  - quantite_commandee
  - unite_commande
  - prix_unitaire
```

### 6.2 Champs conditionnels

```
⚠️ CONDITIONNELS:
- plant: Obligatoire si gestion par site
- storage_location: Obligatoire si gestion des emplacements
- material_group: Recommandé pour analytics
- tax_code: Obligatoire selon pays/région
```

---

## 7. Validation et Tests

### 7.1 Checklist de validation

- [ ] Tous les champs obligatoires SAP sont présents
- [ ] Les types de données correspondent
- [ ] Les longueurs de champs sont correctes
- [ ] Les énumérations utilisent les codes SAP
- [ ] Les clés étrangères sont cohérentes
- [ ] Les calculs (montants) sont corrects
- [ ] Les formats de dates sont compatibles
- [ ] Les codes de devises sont ISO 4217
- [ ] Les codes pays sont ISO 3166-1 alpha-3

### 7.2 Tests de synchronisation

```javascript
// Test 1: Mapper une commande SAP → CDS
const sapOrder = {
  PurchaseOrder: "4500000001",
  PurchaseOrderType: "NB",
  CompanyCode: "1000",
  // ...
};

// Test 2: Vérifier les champs manquants
// Test 3: Valider les types de données
// Test 4: Tester les cas limites
```

---

## 8. Documentation des Décisions

### 8.1 Champs SAP non inclus

| Champ SAP                     | Raison de l'exclusion             |
| ----------------------------- | --------------------------------- |
| `PurchaseOrderSubtype`        | Non utilisé dans le contexte Yaas |
| `SupplierRespSalesPersonName` | Géré côté fournisseur             |
| `SupplierPhoneNumber`         | Redondant avec Business Partner   |

### 8.2 Champs custom ajoutés

| Champ Custom        | Justification                          |
| ------------------- | -------------------------------------- |
| `urgence`           | Besoin métier pour priorisation        |
| `score_priorite`    | Calculé par ML pour aide à la décision |
| `taux_retard_moyen` | Analytics fournisseurs                 |
| `score_performance` | Évaluation fournisseurs                |

---

## 9. Prochaines Étapes

1. ✅ Analyser les APIs SAP Business Hub
2. ✅ Créer la matrice de comparaison
3. ✅ Identifier les champs manquants
4. ⏳ Valider avec l'encadrant Yaas
5. ⏳ Tester la synchronisation SAP
6. ⏳ Mettre à jour le code de synchronisation
7. ⏳ Migrer les données existantes
8. ⏳ Valider en environnement de test

---

## 10. Ressources et Références

### APIs SAP Business Hub

- Purchase Order API: https://api.sap.com/api/API_PURCHASEORDER_PROCESS_SRV
- Business Partner API: https://api.sap.com/api/API_BUSINESS_PARTNER

### Documentation SAP

- S/4HANA Purchase Order: https://help.sap.com/docs/SAP_S4HANA_CLOUD
- OData Protocol: https://www.odata.org/documentation/

### Standards

- ISO 4217 (Devises): https://www.iso.org/iso-4217-currency-codes.html
- ISO 3166-1 (Pays): https://www.iso.org/iso-3166-country-codes.html
- Incoterms 2020: https://iccwbo.org/resources-for-business/incoterms-rules/
