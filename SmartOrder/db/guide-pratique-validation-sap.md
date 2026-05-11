# Guide Pratique : Validation du Schéma CDS avec SAP Business Hub

## Méthode Étape par Étape (A à Z)

---

## 📋 Vue d'ensemble

Ce guide te permettra de :

1. Analyser les APIs SAP Business Hub
2. Comparer avec ton schéma CDS existant
3. Identifier les incohérences
4. Corriger et améliorer ton schéma
5. Valider techniquement et fonctionnellement

**Durée estimée** : 4-6 heures pour une première entité complète

---

## 🎯 Phase 1 : Préparation (30 minutes)

### Étape 1.1 : Créer un compte SAP Business Hub

1. Va sur https://api.sap.com/
2. Clique sur "Sign Up" (en haut à droite)
3. Utilise ton email professionnel Yaas si possible
4. Confirme ton email
5. Connecte-toi

### Étape 1.2 : Identifier ton contexte SAP chez Yaas

**Questions à poser à ton encadrant** :

```
□ Quel système SAP utilise Yaas ?
  ○ SAP S/4HANA Cloud
  ○ SAP S/4HANA On-Premise
  ○ SAP ECC
  ○ SAP Ariba
  ○ Autre : __________

□ Quelle version ?
  Version : __________

□ Quels modules sont utilisés ?
  □ MM (Materials Management)
  □ SD (Sales & Distribution)
  □ PP (Production Planning)
  □ Autre : __________

□ Y a-t-il des développements custom ?
  □ Oui → Demander la documentation
  □ Non
```

### Étape 1.3 : Préparer ton environnement de travail

Crée un dossier de travail :

```
validation-sap/
├── apis-metadata/          # Fichiers $metadata téléchargés
├── comparaisons/           # Tableaux Excel de comparaison
├── screenshots/            # Captures d'écran des APIs
└── notes-reunion.md        # Notes des échanges avec l'encadrant
```

---

## 🔍 Phase 2 : Analyse des APIs SAP (1-2 heures)

### Étape 2.1 : Rechercher les APIs pertinentes

1. **Sur SAP Business Hub**, utilise la barre de recherche :
   - Tape : `Purchase Order`
   - Filtre par : `APIs` (pas Packages)
   - Filtre par : `OData V2` ou `OData V4`

2. **APIs à identifier** :

| Recherche          | API attendue                    | Utilité           |
| ------------------ | ------------------------------- | ----------------- |
| "Purchase Order"   | `API_PURCHASEORDER_PROCESS_SRV` | Commandes d'achat |
| "Business Partner" | `API_BUSINESS_PARTNER`          | Fournisseurs      |
| "Material"         | `API_MATERIAL_STOCK_SRV`        | Articles/Produits |
| "Plant"            | `API_PLANT_SRV`                 | Sites/Usines      |

### Étape 2.2 : Explorer une API (exemple : Purchase Order)

1. **Clique sur** `API_PURCHASEORDER_PROCESS_SRV`

2. **Onglet "Overview"** :
   - Lis la description
   - Note la version
   - Vérifie la compatibilité (Cloud/On-Premise)

3. **Onglet "API Reference"** :
   - Tu verras la liste des EntitySets
   - Exemple :
     ```
     A_PurchaseOrder
     A_PurchaseOrderItem
     A_PurOrdAccountAssignment
     A_PurchaseOrderScheduleLine
     ```

4. **Cliquer sur un EntitySet** (ex: `A_PurchaseOrder`) :
   - Tu verras tous les champs (Properties)
   - Pour chaque champ, note :
     - Nom
     - Type (Edm.String, Edm.Decimal, etc.)
     - MaxLength
     - Nullable (true/false)

### Étape 2.3 : Télécharger les métadonnées

1. **Trouver l'URL $metadata** :
   - Dans l'onglet "API Reference"
   - Cherche un lien comme : `https://sandbox.api.sap.com/.../API_PURCHASEORDER_PROCESS_SRV/$metadata`

2. **Télécharger le fichier** :
   - Clique sur le lien ou copie l'URL
   - Ouvre dans un navigateur
   - Sauvegarde le fichier XML : `purchase-order-metadata.xml`

3. **Ouvrir avec un éditeur XML** :
   - Visual Studio Code
   - Notepad++
   - Ou un éditeur en ligne : https://codebeautify.org/xmlviewer

### Étape 2.4 : Extraire les informations clés

**Créer un fichier Excel** : `comparaison-purchase-order.xlsx`

**Colonnes** :

- A : Champ SAP
- B : Type SAP
- C : Longueur Max
- D : Obligatoire (Nullable=false)
- E : Champ CDS actuel
- F : Type CDS actuel
- G : Statut (✅ OK / ⚠️ Ajuster / ❌ Manquant)
- H : Action requise

**Exemple de remplissage** :

| Champ SAP     | Type SAP   | Max | Oblig. | Champ CDS   | Type CDS    | Statut | Action       |
| ------------- | ---------- | --- | ------ | ----------- | ----------- | ------ | ------------ |
| PurchaseOrder | Edm.String | 10  | Oui    | numero_sap  | String(20)  | ⚠️     | Réduire à 10 |
| CompanyCode   | Edm.String | 4   | Oui    | -           | -           | ❌     | Ajouter      |
| Supplier      | Edm.String | 10  | Oui    | fournisseur | Association | ✅     | OK           |

---

## 📊 Phase 3 : Comparaison et Analyse (1-2 heures)

### Étape 3.1 : Comparer champ par champ

**Pour chaque champ SAP** :

1. **Existe-t-il dans ton schéma CDS ?**
   - ✅ Oui → Passer à l'étape 2
   - ❌ Non → Marquer comme "Manquant" et noter l'action

2. **Le type de données est-il compatible ?**

   ```
   SAP Edm.String → CDS String ✅
   SAP Edm.Decimal → CDS Decimal ✅
   SAP Edm.DateTime → CDS DateTime ✅
   SAP Edm.Boolean → CDS Boolean ✅
   SAP Edm.Int32 → CDS Integer ✅
   ```

3. **La longueur est-elle correcte ?**
   - Si SAP = String(10) et CDS = String(20) → ⚠️ Ajuster
   - Si SAP = String(10) et CDS = String(10) → ✅ OK

4. **Le champ est-il obligatoire ?**
   - Si SAP Nullable=false et CDS n'a pas "not null" → ⚠️ Ajouter

### Étape 3.2 : Identifier les catégories d'écarts

**Créer un tableau de synthèse** :

| Catégorie                     | Nombre | Priorité     | Exemples                            |
| ----------------------------- | ------ | ------------ | ----------------------------------- |
| Champs obligatoires manquants | 5      | 🔴 Critique  | CompanyCode, PurchasingOrganization |
| Types incompatibles           | 2      | 🟠 Important | numero_poste (Integer → String)     |
| Longueurs incorrectes         | 8      | 🟡 Moyen     | numero_sap (20 → 10)                |
| Champs optionnels manquants   | 15     | 🟢 Faible    | IncotermsLocation, TaxNumber        |

### Étape 3.3 : Analyser les champs custom

**Pour chaque champ dans ton CDS qui n'existe PAS dans SAP** :

1. **Est-ce un champ calculé ?**
   - Exemple : `montant_total` (somme des lignes)
   - Action : Garder, mais documenter le calcul

2. **Est-ce un champ métier spécifique ?**
   - Exemple : `urgence`, `score_priorite`
   - Action : Garder, c'est une extension custom

3. **Est-ce un champ ML/Analytics ?**
   - Exemple : `taux_retard_moyen`, `score_performance`
   - Action : Garder, c'est la valeur ajoutée SmartOrder

---

## 🔧 Phase 4 : Correction du Schéma (2-3 heures)

### Étape 4.1 : Prioriser les corrections

**Ordre de priorité** :

1. 🔴 **Critique** : Champs obligatoires SAP manquants
2. 🟠 **Important** : Types de données incompatibles
3. 🟡 **Moyen** : Longueurs de champs incorrectes
4. 🟢 **Faible** : Champs optionnels manquants

### Étape 4.2 : Créer un nouveau schéma (version améliorée)

**Option 1 : Modifier le schéma existant**

```bash
# Créer une sauvegarde
cp db/schema.cds db/schema-backup-$(date +%Y%m%d).cds
```

**Option 2 : Créer un nouveau fichier** (recommandé)

```bash
# Créer une version améliorée
cp db/schema.cds db/schema-sap-enhanced.cds
```

### Étape 4.3 : Appliquer les corrections

**Exemple de correction 1 : Ajouter un champ obligatoire**

```cds
// AVANT
entity Orders {
  key ID : UUID;
  numero_sap : String(20) not null;
  // ...
}

// APRÈS
entity Orders {
  key ID : UUID;
  numero_sap : String(10) not null;  // ✅ Longueur corrigée
  company_code : String(4) not null;  // ✅ Champ ajouté
  purchasing_organization : String(4) not null;  // ✅ Champ ajouté
  purchasing_group : String(3) not null;  // ✅ Champ ajouté
  // ...
}
```

**Exemple de correction 2 : Corriger un type**

```cds
// AVANT
entity LignesCommande {
  numero_poste : Integer not null;
  // ...
}

// APRÈS
entity LignesCommande {
  numero_poste : String(5) not null;  // ✅ Type corrigé (SAP utilise String)
  // ...
}
```

**Exemple de correction 3 : Ajouter des énumérations SAP**

```cds
// AVANT
type StatutEnum : String enum {
  EN_ATTENTE = 'EN_ATTENTE';
  EN_COURS = 'EN_COURS';
  // ...
}

// APRÈS
type StatutSAPEnum : String enum {
  EN_CREATION = '01';      // ✅ Codes SAP standards
  APPROUVE = '02';
  EN_COMMANDE = '03';
  CONFIRME = '04';
  PARTIELLEMENT = '05';
  LIVRE = '06';
  FACTURE = '07';
  ANNULE = '08';
  BLOQUE = '09';
}
```

### Étape 4.4 : Documenter les changements

**Créer un fichier** : `db/CHANGELOG-schema.md`

```markdown
# Changelog du Schéma CDS

## Version 2.0 - Alignement SAP (2024-XX-XX)

### Ajouts

- ✅ Champs organisationnels SAP (CompanyCode, PurchasingOrganization, PurchasingGroup)
- ✅ Champs commerciaux SAP (PaymentTerms, Incoterms)
- ✅ Champs de workflow SAP (ReleaseIsNotCompleted)

### Modifications

- ⚠️ `numero_sap` : String(20) → String(10)
- ⚠️ `numero_poste` : Integer → String(5)
- ⚠️ Énumérations de statut : codes texte → codes numériques SAP

### Suppressions

- ❌ Aucune (tous les champs custom conservés)

### Raisons

- Alignement avec API_PURCHASEORDER_PROCESS_SRV
- Faciliter la synchronisation SAP
- Respecter les standards SAP
```

---

## ✅ Phase 5 : Validation Technique (1 heure)

### Étape 5.1 : Valider la syntaxe CDS

```bash
# Vérifier la syntaxe
cds compile db/schema-sap-enhanced.cds

# Si erreurs, corriger et relancer
```

### Étape 5.2 : Tester le déploiement

```bash
# Déployer en local (PostgreSQL)
cds deploy --to postgres --profile local

# Vérifier les tables créées
psql -d smartorder -c "\dt"
```

### Étape 5.3 : Vérifier les contraintes

```sql
-- Vérifier les contraintes NOT NULL
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND is_nullable = 'NO';

-- Vérifier les clés étrangères
SELECT constraint_name, table_name, column_name
FROM information_schema.key_column_usage
WHERE table_name = 'orders';
```

### Étape 5.4 : Tester les insertions

```javascript
// test-schema.js
const cds = require("@sap/cds");

async function testSchema() {
  const db = await cds.connect.to("db");
  const { Orders, Fournisseurs } = db.entities("smartorder");

  // Test 1: Créer un fournisseur
  const fournisseur = await INSERT.into(Fournisseurs).entries({
    code_sap: "0000100001",
    nom: "Test Supplier",
    pays: "MAR",
  });

  // Test 2: Créer une commande avec tous les champs obligatoires
  const order = await INSERT.into(Orders).entries({
    numero_sap: "4500000001",
    type_commande: "NB",
    statut_sap: "01",
    company_code: "1000",
    purchasing_organization: "1010",
    purchasing_group: "001",
    fournisseur_ID: fournisseur.ID,
    devise: "EUR",
    date_document: new Date(),
    date_creation: new Date(),
    date_commande: new Date(),
    montant_total: 1000.0,
  });

  console.log("✅ Tests réussis !");
}

testSchema().catch(console.error);
```

---

## 📝 Phase 6 : Validation Fonctionnelle (1-2 heures)

### Étape 6.1 : Créer des scénarios de test

**Scénario 1 : Synchronisation d'une commande SAP**

```javascript
// Données SAP simulées
const sapPurchaseOrder = {
  PurchaseOrder: "4500000001",
  PurchaseOrderType: "NB",
  CompanyCode: "1000",
  PurchasingOrganization: "1010",
  PurchasingGroup: "001",
  Supplier: "0000100001",
  DocumentCurrency: "EUR",
  DocumentDate: "2024-01-15",
  CreationDate: "2024-01-15T10:30:00",
  PurchaseOrderDate: "2024-01-15",
  // ...
};

// Mapper vers CDS
const cdsOrder = {
  numero_sap: sapPurchaseOrder.PurchaseOrder,
  type_commande: sapPurchaseOrder.PurchaseOrderType,
  company_code: sapPurchaseOrder.CompanyCode,
  // ...
};

// Vérifier que tous les champs sont mappés
```

**Scénario 2 : Gestion des valeurs nulles**

```javascript
// Test avec champs optionnels manquants
const orderMinimal = {
  numero_sap: "4500000002",
  type_commande: "NB",
  statut_sap: "01",
  company_code: "1000",
  purchasing_organization: "1010",
  purchasing_group: "001",
  // Pas de PaymentTerms, Incoterms, etc.
};

// Doit fonctionner sans erreur
```

**Scénario 3 : Validation des longueurs**

```javascript
// Test avec valeurs à la limite
const orderLimites = {
  numero_sap: "1234567890", // 10 caractères (max)
  company_code: "1000", // 4 caractères (max)
  // ...
};

// Test avec valeurs trop longues (doit échouer)
const orderInvalide = {
  numero_sap: "12345678901", // 11 caractères (trop long)
  // ...
};
```

### Étape 6.2 : Valider avec des données réelles

**Demander à ton encadrant** :

1. **Exporter quelques commandes SAP** (5-10 exemples)
   - Format : Excel ou JSON
   - Inclure tous les champs

2. **Tester le mapping** :

   ```javascript
   // Pour chaque commande SAP
   for (const sapOrder of sapOrders) {
     try {
       const cdsOrder = mapSAPtoCDS(sapOrder);
       await INSERT.into(Orders).entries(cdsOrder);
       console.log(`✅ Commande ${sapOrder.PurchaseOrder} importée`);
     } catch (error) {
       console.error(`❌ Erreur pour ${sapOrder.PurchaseOrder}:`, error);
     }
   }
   ```

3. **Analyser les erreurs** :
   - Champs manquants ?
   - Types incompatibles ?
   - Valeurs hors limites ?

### Étape 6.3 : Documenter les résultats

**Créer un rapport** : `validation-results.md`

```markdown
# Rapport de Validation du Schéma CDS

## Date : 2024-XX-XX

## Validé par : [Ton nom]

## Encadrant : [Nom encadrant Yaas]

## Résumé

- ✅ Champs obligatoires SAP : 100% couverts
- ✅ Types de données : 100% compatibles
- ✅ Tests d'insertion : 10/10 réussis
- ⚠️ Champs optionnels : 80% couverts (20% non pertinents)

## Détails des tests

### Test 1 : Synchronisation commande SAP

- Statut : ✅ Réussi
- Commandes testées : 10
- Erreurs : 0

### Test 2 : Validation des contraintes

- Statut : ✅ Réussi
- Contraintes NOT NULL : OK
- Clés étrangères : OK

### Test 3 : Cas limites

- Statut : ✅ Réussi
- Longueurs max : OK
- Valeurs nulles : OK

## Recommandations

1. Déployer en environnement de test
2. Tester avec volume réel (1000+ commandes)
3. Valider les performances
```

---

## 🎓 Phase 7 : Présentation à l'Encadrant (30 minutes)

### Étape 7.1 : Préparer la présentation

**Structure recommandée** :

1. **Introduction** (2 min)
   - Contexte : Schéma initial non validé
   - Objectif : Aligner avec SAP standards

2. **Méthodologie** (3 min)
   - Analyse SAP Business Hub
   - Comparaison champ par champ
   - Corrections appliquées

3. **Résultats** (10 min)
   - Champs ajoutés (avec justification)
   - Champs modifiés (avec raisons)
   - Champs conservés (custom)

4. **Démonstration** (10 min)
   - Montrer le nouveau schéma
   - Montrer les tests réussis
   - Montrer le mapping SAP

5. **Questions et validation** (5 min)
   - Répondre aux questions
   - Obtenir la validation
   - Noter les ajustements demandés

### Étape 7.2 : Documents à préparer

**Pack de validation** :

```
presentation-validation/
├── 01-schema-comparison.xlsx       # Comparaison avant/après
├── 02-schema-sap-enhanced.cds      # Nouveau schéma
├── 03-sap-field-mapping.md         # Mapping détaillé
├── 04-validation-results.md        # Résultats des tests
├── 05-changelog.md                 # Liste des changements
└── 06-presentation.pptx            # Slides de présentation
```

### Étape 7.3 : Questions à poser à l'encadrant

```
□ Le schéma couvre-t-il tous les besoins métier Yaas ?
□ Y a-t-il des champs SAP custom chez Yaas à ajouter ?
□ Les codes de statut correspondent-ils aux processus Yaas ?
□ Les champs ML/Analytics sont-ils pertinents ?
□ Quand peut-on déployer en environnement de test ?
□ Qui valide la mise en production ?
```

---

## 📚 Phase 8 : Documentation Finale (1 heure)

### Étape 8.1 : Mettre à jour la documentation

**Fichiers à créer/mettre à jour** :

1. **README-schema.md** : Vue d'ensemble du schéma
2. **ARCHITECTURE.md** : Architecture des données
3. **API-MAPPING.md** : Mapping SAP ↔ CDS
4. **MIGRATION-GUIDE.md** : Guide de migration des données

### Étape 8.2 : Créer un guide de maintenance

```markdown
# Guide de Maintenance du Schéma CDS

## Quand mettre à jour le schéma ?

1. **Nouvelle version de l'API SAP**
   - Vérifier les changements dans SAP Business Hub
   - Comparer avec le schéma actuel
   - Appliquer les corrections nécessaires

2. **Nouveaux besoins métier**
   - Ajouter les champs custom
   - Documenter la raison
   - Ne pas modifier les champs SAP standards

3. **Optimisations ML**
   - Ajouter les champs calculés
   - Documenter les formules
   - Créer des vues si nécessaire

## Processus de validation

1. Analyser le besoin
2. Vérifier la compatibilité SAP
3. Modifier le schéma
4. Tester en local
5. Valider avec l'encadrant
6. Déployer en test
7. Déployer en production
```

---

## 🎯 Checklist Finale

### Validation Technique

- [ ] Syntaxe CDS correcte
- [ ] Déploiement réussi
- [ ] Contraintes validées
- [ ] Tests d'insertion OK
- [ ] Performances acceptables

### Validation Fonctionnelle

- [ ] Tous les champs SAP obligatoires présents
- [ ] Types de données compatibles
- [ ] Longueurs de champs correctes
- [ ] Énumérations conformes
- [ ] Mapping SAP documenté

### Validation Métier

- [ ] Besoins Yaas couverts
- [ ] Champs custom justifiés
- [ ] Processus métier respectés
- [ ] Encadrant a validé

### Documentation

- [ ] Schéma commenté
- [ ] Mapping documenté
- [ ] Tests documentés
- [ ] Guide de maintenance créé

---

## 🚀 Prochaines Étapes

1. **Court terme** (1 semaine)
   - Appliquer les corrections au schéma
   - Valider avec l'encadrant
   - Déployer en environnement de test

2. **Moyen terme** (2-4 semaines)
   - Migrer les données existantes
   - Tester la synchronisation SAP
   - Former l'équipe

3. **Long terme** (1-3 mois)
   - Déployer en production
   - Monitorer les performances
   - Optimiser si nécessaire

---

## 📞 Support et Ressources

### Contacts

- **Encadrant Yaas** : [Nom et email]
- **Expert SAP Yaas** : [Nom et email]
- **Support SAP** : https://support.sap.com/

### Ressources

- **SAP Business Hub** : https://api.sap.com/
- **SAP Help Portal** : https://help.sap.com/
- **CAP Documentation** : https://cap.cloud.sap/docs/
- **CDS Language** : https://cap.cloud.sap/docs/cds/

### Communautés

- **SAP Community** : https://community.sap.com/
- **Stack Overflow** : Tag `sap` ou `sap-cap`
- **GitHub** : https://github.com/SAP

---

**Bonne chance avec ta validation ! 🎉**
