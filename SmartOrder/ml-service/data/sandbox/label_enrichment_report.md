# SmartOrder ML -- Label Enrichment Feasibility Report

**Generated:** 2026-07-12 01:48:04  
**Purpose:** Pre-Phase-4 investigation -- can HistoriqueStatut or Predictions provide additional labels?  

---

## TL;DR -- Reponse en 2 minutes

> [!NOTE]
> **RECOMMANDATION: `SKIP_PROCEED_TO_PHASE4`**
>
> **PASSER DIRECTEMENT A LA PHASE 4.** Ni HistoriqueStatut ni Predictions n'apportent de labels fiables supplementaires. Les donnees synthetiques generees (Phase 3) sont suffisantes pour un premier entrainement.

| Source | Labels fiables (HIGH) | Labels moyens (MEDIUM) | Labels faibles (LOW/unconfirmed) |
|--------|----------------------|------------------------|----------------------------------|
| `HistoriqueStatut` | **0** (transitions LIVRE reelles) | 0 | 0 |
| `Predictions` | 0 | **0** (duree_reelle renseignee) | **4** (non confirmes) |
| **Total** | **0** | **0** | **4** |

---

## 1. Etat actuel des labels

Source: `orders_canonical.parquet`

| target_class | Count | % du total labelle |
|-------------|-------|--------------------|
| `on_time` | 2 | 67% |
| `late_non_blocking` | 0 | 0% |
| `late_blocking` | 1 | 33% |

**Total labelle:** 3 / 60 (5%)
**Non labelle:** 57

---

## 2. HistoriqueStatut -- Analyse detaillee

**Fichier:** `smartorder_historiquestatut.csv`  
**Lignes:** 2 | **Commandes couvertes:** 2  
**Colonnes:** `id, commande_id, user_id, ancien_statut, nouveau_statut, commentaire, source_changement, createdat`

### Structure confirmee : transitions datees

Le fichier trace bien les changements de statut avec horodatage (`createdat`), `ancien_statut`, `nouveau_statut`.

**Transitions vers LIVRE (candidat `date_livraison_reelle`) :** 1

> [!NOTE]
> Aucune incoherence detectee entre les dates de HistoriqueStatut et les `date_livraison_reelle` existantes.


**Nouveaux labels potentiels pour commandes non labelees:** 0

*Aucun nouveau label calculable (soit aucune transition LIVRE sur commandes non labelees, soit dates previsionnelles manquantes).*

### Evaluation du volume

- Transitions LIVRE sur commandes **deja labelees** : 1 (confirmation, pas de gain net)
- Transitions LIVRE sur commandes **non labelees** : 0 (gain net potentiel)
- Incoherences detectees : 0

---

## 3. Predictions -- Analyse detaillee

**Fichier:** `smartorder_predictions.csv`  
**Lignes:** 4 | **Commandes couvertes:** 4  
**Colonnes:** `id, commande_id, risque_label, risque_score, risque_probabilites, duree_estimee_jours, duree_reelle_jours, score_composite, priorite_action, suggestion, features_snapshot, modele_version, calcule_le, recalcul_requis`

### Statut de confirmation

| Statut | Count | Signification |
|--------|-------|---------------|
| `duree_reelle_jours` renseignee | 0 | Prediction CONFIRMEE par un resultat reel (confiance MEDIUM) |
| `duree_reelle_jours` NULL | 4 | Prediction NON CONFIRMEE -- label FAIBLE seulement |

### Distribution `risque_label`

| risque_label | Count | Mapped target_class | Fiabilite |
|-------------|-------|---------------------|-----------|
| `ELEVE` | 2 | `late_blocking` | LOW (mapping approx.) |
| `MOYEN` | 1 | `late_non_blocking` | LOW (mapping approx.) |
| `FAIBLE` | 1 | `on_time` | LOW (mapping approx.) |

> [!CAUTION]
> **Le mapping `risque_label` -> `target_class` est une APPROXIMATION, pas une equivalence.**
>
> - `risque_label` (FAIBLE/MOYEN/ELEVE) = score de risque calcule par le systeme a un instant T
> - `target_class` (on_time/late_non_blocking/late_blocking) = resultat reel observe a posteriori
>
> Ces deux grandeurs ne sont PAS identiques. Une commande `MOYEN` risque peut tres bien se terminer `on_time`. Utiliser ce mapping sans le signaler dans `data_source` serait de la tromperie de label.

### Couverture des commandes non labelees

**Predictions couvrant des commandes sans `date_livraison_reelle` :** 4 / 4

| commande_id | risque_label | mapped_target_class | risque_score | confidence |
| --- | --- | --- | --- | --- |
| a1000001-0001-0001-0001-000000000001 | MOYEN | late_non_blocking | 0.45 | LOW (unconfirmed prediction, not a real observation) |
| a1000001-0001-0001-0001-000000000004 | ELEVE | late_blocking | 0.78 | LOW (unconfirmed prediction, not a real observation) |
| a1000001-0001-0001-0001-000000000005 | FAIBLE | on_time | 0.15 | LOW (unconfirmed prediction, not a real observation) |
| a1000001-0001-0001-0001-000000000008 | ELEVE | late_blocking | 0.92 | LOW (unconfirmed prediction, not a real observation) |

---

## 4. Distribution projetee si labels integres

| Scenario | on_time | late_non_blocking | late_blocking | Total labels |
|----------|---------|-------------------|---------------|--------------|
| `Actuel (base)` | 2 | 0 | 1 | 3 |
| `+HistoriqueStatut [HIGH]` | 2 | 0 | 1 | 3 |
| `+Predictions [MEDIUM]` | 2 | 0 | 1 | 3 |
| `+Predictions [LOW/weak]` | 3 | 1 | 3 | 7 |

> Les scenarios [MEDIUM] et [LOW/weak] sont indicatifs. Ne jamais fusionner labels faibles et labels reels sans colonne `data_source` distincte.

---

## 5. Recommandation finale

> [!NOTE]
> **SKIP_PROCEED_TO_PHASE4**

### Pourquoi passer directement a la Phase 4

- **HistoriqueStatut** : seulement 2 lignes dont 0 couvrant des commandes actuellement non labelees avec une transition LIVRE exploitable.
- **Predictions** : 4 lignes dont 0 avec `duree_reelle_jours` confirme, et le mapping `risque_label -> target_class` est approximatif.
- Le dataset synthetique Phase 3 (100 lignes, 3 classes, train/test valide) est suffisant pour un premier entrainement exploratoire.
- **Prioriser** : obtenir de vraies `date_livraison_reelle` via l'equipe SAP/metier plutot que d'extraire des signaux tres faibles de ces deux fichiers.

### Tableau effort / gain

| Source | Labels supplementaires | Fiabilite | Effort integration | Recommandation |
|--------|----------------------|-----------|-------------------|----------------|
| HistoriqueStatut | 0 | HIGH | Faible (1-2h) | Skip |
| Predictions (confirmed) | 0 | MEDIUM | Moyen (3-4h) | Skip |
| Predictions (unconfirmed) | 4 | LOW | Eleve (risque biais) | Skip |

---

## 6. Annexe -- Donnees brutes

### HistoriqueStatut (toutes les lignes)

| id | commande_id | user_id | ancien_statut | nouveau_statut | commentaire | source_changement | createdat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| h1000001-0001-0001-0001-000000000001 | a1000001-0001-0001-0001-000000000004 | u1000001-0001-0001-0001-000000000003 | EN_COURS | BLOQUE | Fournisseur BP001001 ne répond plus aux relances depuis 5 jo | APP_WEB | 2025-04-22 16:00:00 |
| h1000001-0001-0001-0001-000000000002 | a1000001-0001-0001-0001-000000000003 | u1000001-0001-0001-0001-000000000003 | EN_LIVRAISON | LIVRE | Réception confirmée en entrepôt central — BL signé. | APP_WEB | 2025-03-28 14:00:00 |

### Predictions (toutes les lignes)

| id | commande_id | risque_label | risque_score | risque_probabilites | duree_estimee_jours | duree_reelle_jours | score_composite | priorite_action | suggestion | features_snapshot | modele_version | calcule_le | recalcul_requis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| p1000001-0001-0001-0001-000000000001 | a1000001-0001-0001-0001-000000000001 | MOYEN | 0.45 | {"FAIBLE":0.3,"MOYEN":0.45,"ELEVE":0.25} | 35 | nan | 0.62 | SURVEILLER | Surveiller les délais fournisseur | {} | v1.0.0 | 2025-04-15 10:00:00 | false |
| p1000001-0001-0001-0001-000000000002 | a1000001-0001-0001-0001-000000000004 | ELEVE | 0.78 | {"FAIBLE":0.05,"MOYEN":0.17,"ELEVE":0.78} | 45 | nan | 0.88 | ESCALADER | Contacter le fournisseur immédiatement | {} | v1.0.0 | 2025-04-22 16:00:00 | false |
| p1000001-0001-0001-0001-000000000003 | a1000001-0001-0001-0001-000000000005 | FAIBLE | 0.15 | {"FAIBLE":0.75,"MOYEN":0.20,"ELEVE":0.05} | 22 | nan | 0.25 | SURVEILLER | Aucune action requise | {} | v1.0.0 | 2025-04-25 09:00:00 | false |
| p1000001-0001-0001-0001-000000000004 | a1000001-0001-0001-0001-000000000008 | ELEVE | 0.92 | {"FAIBLE":0.02,"MOYEN":0.06,"ELEVE":0.92} | 10 | nan | 0.95 | TRAITER_EN_PRIORITE | Escalader immédiatement — délai critique | {} | v1.0.0 | 2025-04-28 07:00:00 | false |