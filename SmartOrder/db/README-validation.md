# 📚 Documentation de Validation du Schéma CDS

## 🎯 Objectif

Ce dossier contient tous les documents nécessaires pour valider et corriger ton schéma CDS en l'alignant avec les APIs SAP Business Hub.

---

## 📁 Structure des Fichiers

```
db/
├── schema.cds                          # ⚠️ Schéma ACTUEL (à valider)
├── schema-sap-enhanced.cds             # ✅ Schéma AMÉLIORÉ (avec champs SAP)
├── README-validation.md                # 📖 Ce fichier
├── guide-pratique-validation-sap.md    # 📘 Guide étape par étape (A à Z)
├── schema-validation-guide.md          # 📋 Méthodologie et matrices
├── sap-field-mapping.md                # 🗺️ Mapping détaillé SAP ↔ CDS
├── generate-comparison-template.js     # 🔧 Script pour générer les templates Excel
├── comparison-orders.csv               # 📊 Template comparaison Orders (généré)
├── comparison-lignes.csv               # 📊 Template comparaison LignesCommande (généré)
└── comparison-fournisseurs.csv         # 📊 Template comparaison Fournisseurs (généré)
```

---

## 🚀 Démarrage Rapide

### Option 1 : Suivre le guide complet (Recommandé)

1. **Ouvre** : `guide-pratique-validation-sap.md`
2. **Suis les étapes** de A à Z (environ 4-6 heures)
3. **Utilise les templates** Excel pour ta comparaison

### Option 2 : Utiliser directement le schéma amélioré

1. **Compare** : `schema.cds` vs `schema-sap-enhanced.cds`
2. **Consulte** : `sap-field-mapping.md` pour comprendre les changements
3. **Teste** le nouveau schéma en local
4. **Valide** avec ton encadrant

---

## 📖 Description des Documents

### 1. Guide Pratique (guide-pratique-validation-sap.md)

**Contenu** :

- Méthodologie complète étape par étape
- Instructions détaillées pour chaque phase
- Exemples concrets et captures d'écran
- Checklist de validation
- Templates de documents

**Utilisation** :

- Commence par ce document si c'est ta première validation
- Suis les 8 phases dans l'ordre
- Coche les cases au fur et à mesure

**Durée estimée** : 4-6 heures

---

### 2. Schéma Validation Guide (schema-validation-guide.md)

**Contenu** :

- Vue d'ensemble de la méthodologie
- Matrices de comparaison (Orders, Fournisseurs, Lignes)
- Champs SAP manquants identifiés
- Codes et statuts SAP standards
- Plan d'action recommandé

**Utilisation** :

- Référence rapide pour les champs SAP
- Comprendre les écarts entre ton schéma et SAP
- Prioriser les corrections

---

### 3. SAP Field Mapping (sap-field-mapping.md)

**Contenu** :

- Mapping détaillé champ par champ
- Correspondance SAP ↔ CDS
- Types de données et longueurs
- Codes de référence SAP (statuts, types, Incoterms)
- Règles de transformation

**Utilisation** :

- Référence technique pour l'implémentation
- Comprendre chaque champ SAP
- Implémenter la synchronisation SAP

---

### 4. Schéma SAP Enhanced (schema-sap-enhanced.cds)

**Contenu** :

- Schéma CDS complet et corrigé
- Tous les champs SAP standards ajoutés
- Champs custom conservés
- Documentation inline
- Énumérations SAP-compliant

**Utilisation** :

- Remplacer ton schéma actuel (après validation)
- Référence pour l'implémentation
- Base pour la synchronisation SAP

**Principales améliorations** :

- ✅ Champs organisationnels SAP (CompanyCode, PurchasingOrganization, etc.)
- ✅ Champs commerciaux SAP (PaymentTerms, Incoterms, etc.)
- ✅ Champs de workflow SAP (ReleaseIsNotCompleted, etc.)
- ✅ Types et longueurs corrigés
- ✅ Énumérations avec codes SAP standards
- ✅ Tables de référence ajoutées (Plants, StorageLocations, etc.)

---

### 5. Templates de Comparaison (CSV)

**Génération** :

```bash
node db/generate-comparison-template.js
```

**Fichiers générés** :

- `comparison-orders.csv` : Comparaison pour l'entité Orders
- `comparison-lignes.csv` : Comparaison pour LignesCommande
- `comparison-fournisseurs.csv` : Comparaison pour Fournisseurs

**Utilisation** :

1. Ouvre les fichiers CSV dans Excel
2. Utilise les filtres pour trier par priorité
3. Remplis les colonnes au fur et à mesure de ton analyse
4. Partage avec ton encadrant pour validation

**Colonnes** :

- Champ SAP
- Type SAP
- Longueur Max
- Obligatoire
- Champ CDS Actuel
- Type CDS Actuel
- Statut (✅ OK / ⚠️ Ajuster / ❌ Manquant)
- Action Requise
- Priorité (Critique / Important / Moyen / Faible)
- Notes

---

## 🎓 Méthodologie en 8 Phases

### Phase 1 : Préparation (30 min)

- Créer un compte SAP Business Hub
- Identifier le contexte SAP chez Yaas
- Préparer l'environnement de travail

### Phase 2 : Analyse des APIs SAP (1-2h)

- Rechercher les APIs pertinentes
- Explorer les EntitySets
- Télécharger les métadonnées
- Extraire les informations clés

### Phase 3 : Comparaison et Analyse (1-2h)

- Comparer champ par champ
- Identifier les catégories d'écarts
- Analyser les champs custom

### Phase 4 : Correction du Schéma (2-3h)

- Prioriser les corrections
- Créer le nouveau schéma
- Appliquer les corrections
- Documenter les changements

### Phase 5 : Validation Technique (1h)

- Valider la syntaxe CDS
- Tester le déploiement
- Vérifier les contraintes
- Tester les insertions

### Phase 6 : Validation Fonctionnelle (1-2h)

- Créer des scénarios de test
- Valider avec des données réelles
- Documenter les résultats

### Phase 7 : Présentation à l'Encadrant (30 min)

- Préparer la présentation
- Présenter les résultats
- Obtenir la validation

### Phase 8 : Documentation Finale (1h)

- Mettre à jour la documentation
- Créer le guide de maintenance
- Archiver les documents

---

## 📊 Résumé des Changements Principaux

### Entité Orders

#### Champs ajoutés (SAP standards)

```cds
company_code               : String(4)    not null;  // Code société
purchasing_organization    : String(4)    not null;  // Org. d'achat
purchasing_group           : String(3)    not null;  // Groupe acheteurs
plant                      : String(4);              // Site/usine
conditions_paiement        : String(4);              // Conditions paiement
incoterms                  : String(3);              // Incoterms
incoterms_lieu             : String(70);             // Lieu Incoterms
taux_change                : Decimal(9,5);           // Taux de change
deblocage_incomplet        : Boolean;                // Statut déblocage
origine_document           : String(1);              // Origine
date_document              : Date not null;          // Date document
```

#### Champs modifiés

```cds
// AVANT
numero_sap : String(20)
type : String(20)
statut : StatutEnum

// APRÈS
numero_sap : String(10)              // ✅ Longueur SAP
type_commande : TypeCommandeSAPEnum  // ✅ Enum SAP (NB, UB, KB, etc.)
statut_sap : StatutSAPEnum           // ✅ Codes SAP (01-09)
```

### Entité LignesCommande

#### Champs ajoutés

```cds
plant                      : String(4);              // Site livraison
storage_location           : String(4);              // Emplacement
material_group             : String(9);              // Groupe articles
tax_code                   : String(2);              // Code TVA
date_livraison_prevue      : Date;                   // Date livraison
montant_net                : Decimal(14,3);          // Montant net
```

#### Champs modifiés

```cds
// AVANT
numero_poste : Integer
designation_produit : String(500)

// APRÈS
numero_poste : String(5)             // ✅ Type SAP (00010, 00020, etc.)
designation_produit : String(40)     // ✅ Longueur SAP
```

### Entité Fournisseurs

#### Champs ajoutés

```cds
nom_complet                : String(220);            // Nom complet
groupe_compte              : String(4);              // Groupe comptes
region                     : String(3);              // Région
ville                      : String(40);             // Ville
code_postal                : String(10);             // Code postal
rue                        : String(60);             // Rue
fax                        : String(30);             // Fax
numero_tva                 : String(20);             // N° TVA
numero_fiscal              : String(20);             // N° fiscal
devise                     : String(5);              // Devise
conditions_paiement        : String(4);              // Conditions paiement
```

#### Champs modifiés

```cds
// AVANT
code_sap : String(20)
nom : String(200)
email : String(200)

// APRÈS
code_sap : String(10)                // ✅ Longueur SAP
nom : String(80)                     // ✅ Longueur SAP
email : String(241)                  // ✅ Longueur SAP
```

### Nouvelles Entités (Tables de référence)

```cds
entity Plants {
  key plant_code : String(4);
  nom : String(30);
  company_code : String(4);
  // ...
}

entity StorageLocations {
  key plant_code : String(4);
  key storage_location : String(4);
  // ...
}

entity MaterialGroups {
  key material_group : String(9);
  description : String(20);
  // ...
}
```

---

## ✅ Checklist de Validation

### Avant de commencer

- [ ] J'ai accès à SAP Business Hub
- [ ] J'ai identifié le système SAP chez Yaas
- [ ] J'ai lu le guide pratique
- [ ] J'ai préparé mon environnement

### Pendant l'analyse

- [ ] J'ai trouvé les APIs pertinentes
- [ ] J'ai téléchargé les métadonnées
- [ ] J'ai rempli les templates de comparaison
- [ ] J'ai identifié tous les écarts

### Corrections

- [ ] J'ai appliqué les corrections critiques
- [ ] J'ai appliqué les corrections importantes
- [ ] J'ai documenté les changements
- [ ] J'ai conservé les champs custom

### Tests

- [ ] La syntaxe CDS est valide
- [ ] Le déploiement fonctionne
- [ ] Les tests d'insertion passent
- [ ] Les données réelles sont mappables

### Validation

- [ ] L'encadrant a validé le schéma
- [ ] La documentation est complète
- [ ] Le guide de maintenance est créé
- [ ] Les fichiers sont archivés

---

## 🔗 Ressources Externes

### SAP Business Hub

- **URL** : https://api.sap.com/
- **Documentation** : https://help.sap.com/docs/SAP_S4HANA_CLOUD

### APIs Recommandées

- **Purchase Order** : `API_PURCHASEORDER_PROCESS_SRV`
- **Business Partner** : `API_BUSINESS_PARTNER`
- **Material** : `API_MATERIAL_STOCK_SRV`

### Standards

- **ISO 4217** (Devises) : https://www.iso.org/iso-4217-currency-codes.html
- **ISO 3166-1** (Pays) : https://www.iso.org/iso-3166-country-codes.html
- **Incoterms 2020** : https://iccwbo.org/resources-for-business/incoterms-rules/

### Documentation CAP

- **CDS Language** : https://cap.cloud.sap/docs/cds/
- **Best Practices** : https://cap.cloud.sap/docs/guides/

---

## 💡 Conseils et Bonnes Pratiques

### 1. Commence par les champs critiques

Priorise les champs obligatoires SAP (CompanyCode, PurchasingOrganization, etc.)

### 2. Conserve tes champs custom

Les champs ML et analytics sont ta valeur ajoutée, ne les supprime pas !

### 3. Documente tout

Chaque décision doit être documentée pour faciliter la maintenance future.

### 4. Teste progressivement

Ne déploie pas tout d'un coup, teste chaque correction individuellement.

### 5. Implique ton encadrant

Valide régulièrement avec ton encadrant pour éviter les mauvaises surprises.

### 6. Utilise les templates

Les fichiers CSV te feront gagner beaucoup de temps.

### 7. Pense à la migration

Si tu as déjà des données, prépare un script de migration.

---

## 🆘 Problèmes Fréquents

### Problème 1 : API non trouvée sur SAP Business Hub

**Solution** : Vérifie que tu cherches dans la bonne catégorie (APIs, pas Packages). Essaie différentes variantes du nom.

### Problème 2 : Métadonnées trop complexes

**Solution** : Utilise un éditeur XML avec coloration syntaxique. Focus sur les EntityType principaux.

### Problème 3 : Trop de champs SAP

**Solution** : Commence par les champs obligatoires (Nullable=false). Les autres peuvent être ajoutés progressivement.

### Problème 4 : Conflits avec les données existantes

**Solution** : Crée un script de migration. Teste d'abord sur une copie de la base.

### Problème 5 : Encadrant demande des modifications

**Solution** : C'est normal ! Documente les changements et mets à jour le schéma.

---

## 📞 Support

### Contacts Yaas

- **Encadrant** : [À compléter]
- **Expert SAP** : [À compléter]

### Communautés

- **SAP Community** : https://community.sap.com/
- **Stack Overflow** : Tag `sap` ou `sap-cap`

---

## 📅 Planning Suggéré

### Semaine 1

- Jour 1-2 : Analyse des APIs SAP
- Jour 3-4 : Comparaison et identification des écarts
- Jour 5 : Validation avec l'encadrant

### Semaine 2

- Jour 1-2 : Corrections du schéma
- Jour 3 : Tests techniques
- Jour 4 : Tests fonctionnels
- Jour 5 : Documentation finale

### Semaine 3

- Déploiement en environnement de test
- Ajustements si nécessaire
- Préparation de la mise en production

---

## 🎉 Conclusion

Tu as maintenant tous les outils pour valider et corriger ton schéma CDS !

**Prochaines étapes** :

1. Lis le guide pratique (`guide-pratique-validation-sap.md`)
2. Génère les templates de comparaison
3. Commence l'analyse des APIs SAP
4. Applique les corrections
5. Valide avec ton encadrant

**Bonne chance ! 🚀**

---

**Dernière mise à jour** : 2024
**Version** : 1.0
**Auteur** : Documentation générée pour le projet SmartOrder - Yaas Consulting
