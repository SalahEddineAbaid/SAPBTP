# Guide de Validation du Schéma CDS avec SAP Business Hub

## 1. Méthodologie de Validation

### Phase 1 : Identification des APIs SAP pertinentes

#### 1.1 Accès à SAP Business Accelerator Hub

- URL : https://api.sap.com/
- Créer un compte gratuit si nécessaire
- Rechercher les APIs liées aux Purchase Orders

#### 1.2 APIs recommandées à analyser

| API                             | Description                        | Pertinence   |
| ------------------------------- | ---------------------------------- | ------------ |
| `API_PURCHASEORDER_PROCESS_SRV` | Purchase Order API (S/4HANA Cloud) | ⭐⭐⭐ Haute |
| `Purchasing Document API`       | API de documents d'achat           | ⭐⭐⭐ Haute |
| `API_BUSINESS_PARTNER`          | Données fournisseurs               | ⭐⭐ Moyenne |
| `Supplier API`                  | Gestion fournisseurs               | ⭐⭐ Moyenne |

---

## 2. Matrice de Comparaison : Orders (Commandes)

### 2.1 Champs actuels vs Champs SAP standards

| Champ CDS actuel      | Type CDS      | Champ SAP équivalent         | Type SAP       | Statut      | Action               |
| --------------------- | ------------- | ---------------------------- | -------------- | ----------- | -------------------- |
| `numero_sap`          | String(20)    | `PurchaseOrder`              | Edm.String(10) | ✅ OK       | Réduire à 10         |
| `type`                | String(20)    | `PurchaseOrderType`          | Edm.String(4)  | ⚠️ Ajuster  | Réduire à 4          |
| `statut`              | StatutEnum    | `PurchasingProcessingStatus` | Edm.String(2)  | ⚠️ Revoir   | Codes SAP différents |
| `date_creation`       | DateTime      | `CreationDate`               | Edm.DateTime   | ✅ OK       | -                    |
| `date_previsionnelle` | Date          | `PurchaseOrderDate`          | Edm.DateTime   | ✅ OK       | -                    |
| `montant_total`       | Decimal(15,2) | -                            | -              | ❌ Manquant | Calculé côté SAP     |
| `devise`              | String(3)     | `DocumentCurrency`           | Edm.String(5)  | ✅ OK       | -                    |
| -                     | -             | `CompanyCode`                | Edm.String(4)  | ❌ Manquant | À ajouter            |
| -                     | -             | `PurchasingOrganization`     | Edm.String(4)  | ❌ Manquant | À ajouter            |
| -                     | -             | `PurchasingGroup`            | Edm.String(3)  | ❌ Manquant | À ajouter            |
| -                     | -             | `PaymentTerms`               | Edm.String(4)  | ❌ Manquant | À ajouter            |
| -                     | -             | `IncotermsClassification`    | Edm.String(3)  | ❌ Manquant | À ajouter            |

### 2.2 Champs SAP manquants critiques

**Champs organisationnels** :

- `CompanyCode` : Code société (obligatoire dans SAP)
- `PurchasingOrganization` : Organisation d'achat
- `PurchasingGroup` : Groupe d'acheteurs
- `Plant` : Site/usine

**Champs commerciaux** :

- `PaymentTerms` : Conditions de paiement
- `IncotermsClassification` : Incoterms
- `IncotermsLocation` : Lieu Incoterms

**Champs de workflow** :

- `ReleaseIsNotCompleted` : Statut de déblocage
- `PurchasingDocumentOrigin` : Origine du document

---

## 3. Matrice de Comparaison : Fournisseurs

| Champ CDS actuel | Champ SAP équivalent   | Type SAP        | Statut      | Action       |
| ---------------- | ---------------------- | --------------- | ----------- | ------------ |
| `code_sap`       | `Supplier`             | Edm.String(10)  | ✅ OK       | -            |
| `nom`            | `SupplierName`         | Edm.String(80)  | ⚠️ Ajuster  | Réduire à 80 |
| `pays`           | `Country`              | Edm.String(3)   | ✅ OK       | -            |
| `email`          | `EmailAddress`         | Edm.String(241) | ⚠️ Ajuster  | Augmenter    |
| `telephone`      | `PhoneNumber`          | Edm.String(30)  | ✅ OK       | -            |
| -                | `SupplierAccountGroup` | Edm.String(4)   | ❌ Manquant | À ajouter    |
| -                | `VATRegistration`      | Edm.String(20)  | ❌ Manquant | À ajouter    |
| -                | `TaxNumber`            | Edm.String(20)  | ❌ Manquant | À ajouter    |

---

## 4. Matrice de Comparaison : LignesCommande

| Champ CDS actuel      | Champ SAP équivalent    | Type SAP       | Statut      | Action            |
| --------------------- | ----------------------- | -------------- | ----------- | ----------------- |
| `numero_poste`        | `PurchaseOrderItem`     | Edm.String(5)  | ⚠️ Type     | Changer en String |
| `code_produit`        | `Material`              | Edm.String(40) | ✅ OK       | -                 |
| `designation_produit` | `PurchaseOrderItemText` | Edm.String(40) | ⚠️ Ajuster  | Réduire à 40      |
| `quantite_commandee`  | `OrderQuantity`         | Edm.Decimal    | ✅ OK       | -                 |
| `prix_unitaire`       | `NetPriceAmount`        | Edm.Decimal    | ✅ OK       | -                 |
| `unite`               | `OrderPriceUnit`        | Edm.String(3)  | ✅ OK       | -                 |
| -                     | `Plant`                 | Edm.String(4)  | ❌ Manquant | À ajouter         |
| -                     | `StorageLocation`       | Edm.String(4)  | ❌ Manquant | À ajouter         |
| -                     | `MaterialGroup`         | Edm.String(9)  | ❌ Manquant | À ajouter         |
| -                     | `TaxCode`               | Edm.String(2)  | ❌ Manquant | À ajouter         |
| -                     | `DeliveryDate`          | Edm.DateTime   | ❌ Manquant | À ajouter         |

---

## 5. Codes Statuts SAP Standards

### 5.1 PurchasingProcessingStatus (Statut de traitement)

Les codes SAP standards sont généralement :

- `01` : En cours de création
- `02` : Approuvé
- `03` : En commande
- `04` : Confirmé
- `05` : Partiellement livré
- `06` : Livré
- `07` : Facturé
- `08` : Annulé

### 5.2 Mapping avec ton enum actuel

```cds
type StatutSAPEnum : String enum {
  EN_CREATION      = '01';
  APPROUVE         = '02';
  EN_COMMANDE      = '03';
  CONFIRME         = '04';
  PARTIELLEMENT    = '05';
  LIVRE            = '06';
  FACTURE          = '07';
  ANNULE           = '08';
}
```

---

## 6. Procédure de Validation Étape par Étape

### Étape 1 : Accéder à l'API SAP

1. Aller sur https://api.sap.com/
2. Rechercher "Purchase Order"
3. Sélectionner `API_PURCHASEORDER_PROCESS_SRV`
4. Cliquer sur "API Reference"

### Étape 2 : Télécharger les métadonnées

1. Dans l'API Reference, trouver le lien `$metadata`
2. Copier l'URL complète
3. Ouvrir dans un navigateur ou télécharger le fichier XML

### Étape 3 : Analyser le schéma XML

```xml
<EntityType Name="A_PurchaseOrderType">
  <Key>
    <PropertyRef Name="PurchaseOrder"/>
  </Key>
  <Property Name="PurchaseOrder" Type="Edm.String" MaxLength="10" Nullable="false"/>
  <Property Name="PurchaseOrderType" Type="Edm.String" MaxLength="4"/>
  <!-- etc. -->
</EntityType>
```

### Étape 4 : Comparer avec ton schéma CDS

- Créer un tableau Excel avec 3 colonnes :
  - Champ SAP
  - Champ CDS actuel
  - Action requise

### Étape 5 : Identifier les écarts

- Champs manquants dans CDS
- Types de données incompatibles
- Longueurs de champs incorrectes
- Énumérations non conformes

### Étape 6 : Prioriser les corrections

1. **Critique** : Champs obligatoires SAP manquants
2. **Important** : Types de données incompatibles
3. **Moyen** : Longueurs de champs
4. **Faible** : Champs optionnels

---

## 7. Plan d'Action Recommandé

### 7.1 Corrections Critiques (À faire immédiatement)

1. **Ajouter les champs organisationnels SAP** :
   - CompanyCode
   - PurchasingOrganization
   - PurchasingGroup

2. **Corriger les types de données** :
   - `numero_poste` : Integer → String(5)
   - `numero_sap` : String(20) → String(10)

3. **Ajouter les champs de workflow** :
   - ReleaseIsNotCompleted
   - PurchasingDocumentOrigin

### 7.2 Corrections Importantes (À planifier)

1. **Revoir les énumérations de statut**
2. **Ajouter les champs de livraison par ligne**
3. **Ajouter les informations fiscales**

### 7.3 Améliorations (Optionnel)

1. **Ajouter les tables de référence SAP** :
   - Plants (Sites)
   - Storage Locations (Emplacements)
   - Material Groups (Groupes d'articles)

---

## 8. Validation Technique

### 8.1 Tests de cohérence

```javascript
// Vérifier que les longueurs de champs correspondent
// Vérifier que les types sont compatibles
// Vérifier que les clés étrangères sont valides
```

### 8.2 Tests fonctionnels

- Simuler une synchronisation SAP
- Vérifier que tous les champs SAP peuvent être mappés
- Tester les cas limites (valeurs nulles, longueurs max)

---

## 9. Documentation de Validation

### 9.1 Créer un document de mapping

```
SAP Field → CDS Field
PurchaseOrder → numero_sap
PurchaseOrderType → type
etc.
```

### 9.2 Documenter les décisions

- Pourquoi certains champs SAP ne sont pas inclus
- Justification des champs custom ajoutés
- Règles de transformation des données

---

## 10. Checklist de Validation Finale

- [ ] Tous les champs obligatoires SAP sont présents
- [ ] Les types de données sont compatibles
- [ ] Les longueurs de champs sont correctes
- [ ] Les énumérations correspondent aux codes SAP
- [ ] Les associations/compositions sont cohérentes
- [ ] La documentation de mapping est complète
- [ ] Les tests de synchronisation passent
- [ ] L'encadrant a validé le schéma
