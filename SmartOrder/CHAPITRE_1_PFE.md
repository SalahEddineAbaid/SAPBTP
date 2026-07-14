# CHAPITRE 1 : LE PROJET ET LA GESTION DU PROJET

## INTRODUCTION
L'évolution rapide des environnements de gestion d'entreprise, notamment autour des ERP (Enterprise Resource Planning), pousse les organisations à moderniser leurs processus d'approvisionnement. Ce premier chapitre pose les fondations du projet "SmartOrder". Il détaille le contexte de réalisation, la problématique identifiée, et présente les objectifs fonctionnels et techniques. Enfin, il expose la méthodologie de gestion de projet adoptée ainsi que le planning prévisionnel et les technologies mobilisées pour répondre aux exigences fixées.

## CONTEXTE DU PROJET
Le projet s'inscrit dans un contexte d'optimisation de la chaîne d'approvisionnement (Supply Chain) via l'intégration de l'intelligence artificielle. Actuellement, la gestion des commandes d'achat (Purchase Orders) génère d'importants volumes de données qui sont sous-exploités pour l'anticipation des risques. Le développement d'une solution d'extension sur la plateforme SAP BTP (Business Technology Platform) permet de répondre à ce besoin tout en capitalisant sur l'infrastructure existante.

## L’ENTREPRISE D’ACCUEIL
Le projet est réalisé au sein de **YAAS**, une entreprise spécialisée dans l'intégration de solutions SAP et l'innovation technologique. Conformément à une approche d'ingénierie, il est pertinent de souligner que YAAS investit dans la création d'accélérateurs métiers sur SAP BTP, permettant à ses équipes de concevoir des architectures cloud-natives modernes, d'intégrer des modèles de Machine Learning et de fournir des interfaces utilisateurs à forte valeur ajoutée sans s'attarder sur une présentation commerciale classique.

## LE CLIENT
Le projet vise les utilisateurs internes et les partenaires opérant sur des environnements **SAP S/4HANA Cloud**. La solution agit comme un produit destiné aux gestionnaires d'approvisionnement et aux managers, avec pour objectif d'être déployée sur des locataires partenaires (comme le *YAAS Partner Demo Tenant*), et à terme, chez les clients finaux nécessitant un suivi prédictif de leurs commandes.

## LA PROBLÉMATIQUE

La gestion des commandes fournisseurs dans un environnement SAP traditionnel présente des limites en termes de réactivité. La problématique centrale est donc la suivante : **Comment concevoir une application web intelligente, intégrée à SAP, capable d'automatiser le suivi, de prédire les risques de retard et d'offrir un pilotage proactif en temps réel ?**

Cette problématique découle de plusieurs contraintes majeures :
* **Suivi purement réactif** : Les retards sont constatés *a posteriori*, sans anticipation basée sur l'historique.
* **Manque de priorisation** : Aucun score automatique n'identifie les commandes à fort risque.
* **Fragmentation des données** : Les informations réparties sur plusieurs modules SAP rendent la consolidation complexe.
* **Absence d'alertes temps réel** : L'absence de notifications impose un suivi manuel chronophage.
* **Carence analytique** : Les interfaces standards manquent de tableaux de bord ergonomiques pour la prise de décision.

## LE PROJET
Pour répondre à cette problématique, le projet **SmartOrder** a été conçu. Il s'agit d'une application intelligente cloud-native développée sur SAP BTP. SmartOrder agit comme une extension logicielle (Side-by-Side Extensibility) qui se connecte au système SAP S/4HANA pour synchroniser les données d'achat, les enrichir, et appliquer des algorithmes de Machine Learning afin de prédire les risques de retard.

## LES OBJECTIFS FONCTIONNELS DU PROJET
En tant qu'ingénieurs, les fonctionnalités attendues ont été strictement définies pour répondre aux besoins métiers :
- **Synchronisation OData** : Extraction et synchronisation régulières des fournisseurs et des commandes (Purchase Orders) depuis SAP S/4HANA.
- **Tableau de bord et Suivi** : Visualisation centralisée de l'état des commandes, des postes en retard et de la performance des fournisseurs.
- **Intelligence Artificielle (Prédiction des risques)** : Évaluation prédictive du risque de retard pour chaque commande via un modèle de Machine Learning et estimation de la durée de livraison.
- **Gestion des alertes** : Génération et suivi d'alertes basées sur les anomalies (retards, blocages, fournisseurs à risque).
- **Contrôle d'accès basé sur les rôles (RBAC)** : Gestion des droits selon les profils utilisateurs (USER, MANAGER, ADMIN) avec périmètres d'action spécifiques.

## LES OBJECTIFS NON FONCTIONNELS
La robustesse de la solution s'appuie sur des exigences techniques critiques :
- **Performance et Scalabilité** : Architecture en microservices déployable sur Cloud Foundry (SAP BTP) capable de traiter de forts volumes de données.
- **Sécurité** : Intégration de SAP XSUAA pour l'authentification et l'autorisation OAuth 2.0.
- **Portabilité** : Compatibilité de la base de données entre un environnement de développement local (SQLite) et de production cloud (PostgreSQL).
- **Ergonomie (UI/UX)** : Interface web réactive, intuitive et performante offrant une expérience utilisateur fluide.

## LA MÉTHODOLOGIE ADOPTÉE

### Présentation de la Méthode Scrum

La gestion du projet SmartOrder suit la méthodologie Agile **Scrum**, particulièrement adaptée aux développements logiciels itératifs impliquant une forte incertitude technique. Scrum repose sur trois piliers fondamentaux : la **transparence** (visibilité de l'avancement à tout moment), l'**inspection** (révision continue des livrables) et l'**adaptation** (ajustement du plan en fonction des retours).

Les rôles et cérémonies Scrum appliqués au projet sont les suivants :

- **Product Owner** : Responsable de la priorisation du Product Backlog et de la définition des user stories fonctionnelles.
- **Scrum Master** : Garant de l'application du cadre Scrum, facilitateur des réunions et élimination des obstacles.
- **Équipe de développement** : Équipe pluridisciplinaire (Backend, ML, Frontend) en charge de la réalisation des Sprints.
- **Sprint** : Itération de **2 semaines** avec un objectif précis, produisant un incrément logiciel potentiellement livrable.
- **Daily Stand-up** : Réunion quotidienne de 15 minutes pour synchroniser l'équipe et identifier les blocages.
- **Sprint Review** : Démonstration de l'incrément livré aux parties prenantes en fin de Sprint.
- **Sprint Retrospective** : Analyse des points forts et axes d'amélioration pour le Sprint suivant.

---

### Product Backlog

Le Product Backlog liste l'ensemble des fonctionnalités attendues, ordonnées par priorité métier. La complexité est estimée en **points de story** selon la suite de Fibonacci (1, 2, 3, 5, 8, 13).

| ID | User Story | Priorité (1-3) | Complexité | Sprint |
|----|-----------|:---:|-----------|--------|
| **US01** | En tant qu'Admin, je veux configurer le projet SAP BTP (MTA, CDS) pour démarrer le développement | 1 | 3 pts | S1 |
| **US02** | En tant que développeur, je veux modéliser le schéma de données CDS (`Orders`, `Fournisseurs`, `Alertes`) | 1 | 5 pts | S1 |
| **US03** | En tant qu'utilisateur, je veux consulter la liste des commandes avec pagination et filtres | 1 | 8 pts | S2 |
| **US04** | En tant qu'utilisateur, je veux voir le détail d'une commande avec son historique de statuts | 1 | 5 pts | S2 |
| **US05** | En tant que système, je veux synchroniser automatiquement les Purchase Orders depuis SAP S/4HANA | 1 | 13 pts | S3 |
| **US06** | En tant que Manager, je veux que les commandes passent par une machine à états validée | 1 | 8 pts | S3 |
| **US07** | En tant que Data Scientist, je veux entraîner un modèle de classification du risque de retard | 1 | 13 pts | S4 |
| **US08** | En tant que Data Scientist, je veux entraîner un modèle de régression pour estimer la durée de livraison | 2 | 8 pts | S4 |
| **US09** | En tant que système, je veux exposer les prédictions ML via une API FastAPI (`/predict`) | 1 | 5 pts | S4 |
| **US10** | En tant qu'utilisateur, je veux visualiser un Dashboard avec les KPIs des commandes (graphiques, statuts) | 2 | 8 pts | S5 |
| **US11** | En tant qu'utilisateur, je veux consulter la liste des fournisseurs avec leur score de performance | 2 | 3 pts | S5 |
| **US12** | En tant que Manager, je veux voir les vues analytiques et les anomalies détectées | 2 | 8 pts | S6 |
| **US13** | En tant qu'utilisateur, je veux recevoir des alertes en temps réel via WebSocket | 2 | 8 pts | S6 |
| **US14** | En tant qu'Admin, je veux gérer les utilisateurs et leurs rôles depuis une interface dédiée | 3 | 5 pts | S6 |
| **US15** | En tant qu'Admin, je veux configurer XSUAA et le RBAC (USER / MANAGER / ADMIN) sur SAP BTP | 1 | 8 pts | S7 |
| **US16** | En tant que développeur, je veux une couverture de tests unitaires ≥ 70% sur le backend CAP | 2 | 8 pts | S7 |
| **US17** | En tant que développeur, je veux des tests d'intégration et E2E validant les flux critiques | 2 | 5 pts | S7 |
| **US18** | En tant qu'Admin, je veux déployer l'application complète sur SAP BTP via `cf deploy` | 1 | 8 pts | S8 |
| **US19** | En tant qu'Admin, je veux valider le bon fonctionnement en base PostgreSQL de production | 2 | 5 pts | S8 |
| **US20** | En tant que PFE, je veux rédiger et finaliser le rapport de projet | 3 | 3 pts | S8 |

---

### Planification des Sprints

| Sprint | Description | Période |
|--------|-------------|---------|
| **Sprint 1** — Fondations | Initialisation du projet CAP, configuration SAP BTP & MTA, modélisation du schéma de données CDS (`schema.cds`) et mise en place de l'environnement de développement local | Sem. 1 → Sem. 2 |
| **Sprint 2** — API Backend | Développement des services OData CAP (`OrdersService`, `FournisseursService`), implémentation des endpoints CRUD, pagination, filtres `$filter/$orderby/$search` | Sem. 3 → Sem. 4 |
| **Sprint 3** — Intégration SAP | Connexion à SAP S/4HANA via Destination Service, synchronisation automatique des Purchase Orders & fournisseurs, implémentation de la machine à états des commandes | Sem. 5 → Sem. 6 |
| **Sprint 4** — Machine Learning | Extraction des features, entraînement des modèles (Random Forest classification + régression), pipelines Scikit-learn, développement et exposition du service FastAPI (`/predict`, `/retrain`) | Sem. 7 → Sem. 8 |
| **Sprint 5** — Frontend (Base) | Développement du design system React (tokens CSS, composants), implémentation du Dashboard KPIs, page liste des commandes, page fournisseurs | Sem. 9 → Sem. 10 |
| **Sprint 6** — Frontend (Avancé) | Vues analytiques et graphiques (Recharts), gestion des alertes, notifications WebSocket temps réel, interface d'administration des utilisateurs | Sem. 11 → Sem. 12 |
| **Sprint 7** — Sécurité & Tests | Configuration XSUAA (`xs-security.json`) et AppRouter, mise en place du RBAC par scopes, rédaction et exécution de la suite de tests (Jest, React Testing Library, E2E) | Sem. 13 → Sem. 14 |
| **Sprint 8** — Déploiement & Clôture | Build MTA (`mbt build`), déploiement sur Cloud Foundry BTP (`cf deploy`), validation PostgreSQL, recette fonctionnelle finale, rédaction et finalisation du rapport PFE | Sem. 15 → Sem. 16 |


## LES TECHNOLOGIES ADOPTÉES
L'architecture logicielle repose sur une stack technologique moderne et robuste :
- **Infrastructure & Déploiement** : SAP BTP (Cloud Foundry), framework MTA (Multi-Target Application).
- **Backend (API & Logique Métier)** : Node.js avec SAP CAP (Cloud Application Programming Model) et CDS (Core Data Services).
- **Base de données** : PostgreSQL (Production) / SQLite (Développement local).
- **Service Machine Learning** : Python, FastAPI, Scikit-learn pour l'entraînement et l'inférence des modèles prédictifs.
- **Frontend** : React.js pour une application Single-Page (SPA) dynamique.
- **Sécurité** : SAP XSUAA et AppRouter.

## LE PLANNING PRÉVISIONNEL

La planification du projet SmartOrder s'étend sur **16 semaines** (Février → Mai 2025), organisées en **6 phases techniques progressives** et **8 Sprints Scrum** de deux semaines chacun. Cette structuration garantit une livraison incrémentale, une qualité contrôlée à chaque étape et une capacité d'adaptation aux imprévus techniques.

Le calendrier a été conçu en respectant les contraintes suivantes :
- **Dépendances techniques** : le service ML ne peut être développé qu'après la disponibilité des données (fin Phase 2) ; le frontend requiert les APIs backend finalisées.
- **Chemin critique** : les phases Backend, ML et Frontend sont séquentielles et ne tolèrent aucun glissement.
- **Tampon intégré** : 2 semaines dédiées à la clôture pour absorber d'éventuels retards et finaliser la rédaction.

---

### Diagramme de Gantt — Vue Globale

```mermaid
gantt
    title Planning Prévisionnel — SmartOrder (Fév → Mai 2025)
    dateFormat  YYYY-MM-DD
    axisFormat  S%W

    section 🏗️ Phase 1 · Cadrage & Architecture
    Analyse des besoins & étude de l'existant    :done,    p1a, 2025-02-03, 5d
    Architecture SAP BTP & modélisation CDS      :done,    p1b, 2025-02-10, 5d
    Configuration MTA & environnements CI/CD     :done,    p1c, 2025-02-17, 5d
    🏁 Livrable : Dossier d'architecture         :milestone, m1, 2025-02-21, 0d

    section ⚙️ Phase 2 · Backend & Intégration SAP
    Modélisation schéma CDS (schema.cds)         :done,    p2a, 2025-02-24, 4d
    Services CAP OData (Orders, Suppliers)       :done,    p2b, 2025-02-28, 5d
    Synchronisation S/4HANA via Destination      :done,    p2c, 2025-03-07, 5d
    Machine à états & logique métier             :done,    p2d, 2025-03-10, 5d
    🏁 Livrable : API OData fonctionnelle        :milestone, m2, 2025-03-14, 0d

    section 🤖 Phase 3 · Machine Learning & IA
    Extraction & exploration des données         :done,    p3a, 2025-03-17, 5d
    Ingénierie des features & preprocessing     :done,    p3b, 2025-03-21, 4d
    Entraînement modèles (classification+régr.) :done,    p3c, 2025-03-25, 7d
    Développement service FastAPI & intégration  :done,    p3d, 2025-04-01, 5d
    🏁 Livrable : Service ML déployable          :milestone, m3, 2025-04-04, 0d

    section 🎨 Phase 4 · Frontend React
    Design system & bibliothèque composants      :done,    p4a, 2025-04-07, 5d
    Tableaux de bord, KPIs & graphiques         :done,    p4b, 2025-04-11, 7d
    Gestion des commandes & vues par rôle       :done,    p4c, 2025-04-16, 5d
    Alertes temps réel (WebSocket / Socket.IO)  :done,    p4d, 2025-04-21, 5d
    🏁 Livrable : Application React fonctionnelle :milestone, m4, 2025-04-25, 0d

    section 🔐 Phase 5 · Sécurité & Tests
    Configuration XSUAA, AppRouter & RBAC        :done,    p5a, 2025-04-28, 5d
    Tests unitaires backend (Jest/CAP)           :done,    p5b, 2025-05-02, 5d
    Tests d'intégration & E2E (React Testing)   :done,    p5c, 2025-05-07, 5d
    🏁 Livrable : Rapport de tests validé        :milestone, m5, 2025-05-09, 0d

    section 🚀 Phase 6 · Déploiement & Clôture
    Build MTA & déploiement Cloud Foundry        :done,    p6a, 2025-05-12, 5d
    Validation PostgreSQL & recette finale       :done,    p6b, 2025-05-15, 4d
    Rédaction & finalisation rapport PFE         :done,    p6c, 2025-05-19, 7d
    🏁 Livrable : Application déployée + Rapport :milestone, m6, 2025-05-26, 0d
```

---

### Décomposition en Sprints Scrum

Le projet est découpé en **8 Sprints de 2 semaines** selon la méthodologie Agile Scrum. Chaque Sprint possède un objectif précis (Sprint Goal), des user stories associées et un livrable démontrable.

| Sprint | Période | Sprint Goal | User Stories Clés | Livrable Sprint |
|--------|---------|------------|-------------------|-----------------|
| **S01** | Sem. 1–2 | Poser les fondations architecturales | Initialisation projet CAP, configuration BTP & MTA, modèle de données CDS | Environnement de dev fonctionnel + schéma CDS v1 |
| **S02** | Sem. 3–4 | Première API OData opérationnelle | Services `OrdersService`, `FournisseursService`, endpoints CRUD, pagination | Demo `GET /odata/v4/orders` sur données mock |
| **S03** | Sem. 5–6 | Intégration S/4HANA en temps réel | Destination Service, synchronisation des Purchase Orders, machine à états | Sync SAP → BTP fonctionnelle & testable |
| **S04** | Sem. 7–8 | Modèle ML de prédiction des risques | Feature engineering, entraînement Random Forest, API FastAPI `/predict` | Modèle ML avec précision > 80% sur données test |
| **S05** | Sem. 9–10 | Interface utilisateur — Consultation | Design system React, pages Dashboard, liste des commandes, détail commande | SPA React connectée à l'API backend |
| **S06** | Sem. 11–12 | Interface avancée & Temps réel | Vues analytiques, graphiques Recharts, alertes WebSocket, actions par rôle | Application React complète & responsive |
| **S07** | Sem. 13–14 | Sécurisation & validation qualité | XSUAA + AppRouter, RBAC (USER/MANAGER/ADMIN), suite de tests complète | Couverture tests ≥ 70%, sécurité XSUAA validée |
| **S08** | Sem. 15–16 | Déploiement production & livraison | MTA build (`mbt build`), `cf deploy`, validation PostgreSQL, rapport final | Application live sur SAP BTP + Rapport PFE rendu |

---

### Chronologie Détaillée des Phases

| # | Phase | Semaines | Durée | Tâches Principales | Livrable |
|---|-------|---------|-------|-------------------|----------|
| **1** | **Cadrage & Architecture** | 1 → 3 | 3 sem. | Analyse des besoins, étude de l'existant S/4HANA, modélisation `schema.cds`, architecture MTA, mise en place CI/CD local | Dossier d'architecture technique, schéma de données validé |
| **2** | **Backend & Intégration SAP** | 4 → 6 | 3 sem. | Services CAP OData, synchronisation S/4HANA (Purchase Orders & Suppliers), machine à états, middleware RBAC, WebSocket | API OData complète, sync SAP opérationnelle, endpoints /api/me |
| **3** | **Machine Learning & IA** | 7 → 9 | 3 sem. | Extraction features, pipeline Scikit-learn (preprocessing + modèle), entraînement (classification risque + régression durée), service FastAPI | Modèles ML `.pkl`, service FastAPI `/predict` & `/retrain` |
| **4** | **Frontend React** | 10 → 12 | 3 sem. | Design system (tokens CSS), composants réutilisables, Dashboard KPIs, gestion commandes, alertes temps réel Socket.IO | Application SPA React fonctionnelle, responsive et sécurisée |
| **5** | **Sécurité & Tests** | 13 → 14 | 2 sem. | Configuration XSUAA (`xs-security.json`), AppRouter, RBAC par scope, tests unitaires (Jest), tests intégration, E2E (Testing Library) | Rapport de tests (couverture ≥ 70%), audit sécurité validé |
| **6** | **Déploiement & Clôture** | 15 → 16 | 2 sem. | `mbt build`, `cf deploy` sur Cloud Foundry BTP, migration PostgreSQL, recette fonctionnelle, rédaction rapport PFE | Application déployée sur SAP BTP + Rapport PFE finalisé |

---

### Résumé de la Charge par Phase

| Phase | Effort (Jours-Homme) | Complexité | Risque Technique |
|-------|---------------------|-----------|-----------------|
| Phase 1 — Cadrage | 15 j/h | ⭐⭐ Moyenne | 🟢 Faible |
| Phase 2 — Backend SAP | 15 j/h | ⭐⭐⭐⭐ Élevée | 🟡 Modéré |
| Phase 3 — Machine Learning | 15 j/h | ⭐⭐⭐⭐⭐ Très élevée | 🔴 Élevé |
| Phase 4 — Frontend React | 15 j/h | ⭐⭐⭐ Moyenne-Haute | 🟡 Modéré |
| Phase 5 — Sécurité & Tests | 10 j/h | ⭐⭐⭐ Moyenne | 🟡 Modéré |
| Phase 6 — Déploiement | 10 j/h | ⭐⭐⭐ Moyenne | 🟡 Modéré |
| **TOTAL** | **80 j/h** | — | — |

---

### Matrice des Risques du Projet

| # | Risque Identifié | Probabilité | Impact | Criticité | Stratégie de Mitigation |
|---|-----------------|------------|--------|-----------|------------------------|
| **R1** | Indisponibilité de l'API SAP S/4HANA (quota Sandbox) | Élevée | Élevé | 🔴 Critique | Utilisation de mocks CDS en développement, validation sur Sandbox YAAS |
| **R2** | Données insuffisantes pour l'entraînement ML | Moyenne | Élevé | 🔴 Critique | Génération de données synthétiques, fine-tuning avec SMOTE |
| **R3** | Dépassement du délai de 16 semaines | Faible | Élevé | 🟠 Élevé | Buffer de 2 semaines intégré, scope minimal défini par Sprint |
| **R4** | Incompatibilité SQLite ↔ PostgreSQL | Moyenne | Moyen | 🟡 Modéré | Abstraction via CAP CDS, tests dialecte-agnostiques dès Phase 2 |
| **R5** | Erreurs de configuration XSUAA en production | Moyenne | Moyen | 🟡 Modéré | Mode dev avec auth mockée, tests Hybrid avant déploiement final |
| **R6** | Performance insuffisante des appels ML temps réel | Faible | Moyen | 🟢 Faible | Mise en cache des prédictions, recalcul asynchrone via cron |

---

## CONCLUSION

Ce premier chapitre a permis de définir le périmètre exact du projet SmartOrder dans sa globalité. En partant d'une problématique concrète d'anticipation des risques dans la Supply Chain, une réponse technologique cohérente a été structurée autour de SAP BTP, de l'intelligence artificielle et d'une méthodologie Agile rigoureuse.

Le planning prévisionnel en 16 semaines, découpé en 8 Sprints Scrum, garantit une progression maîtrisée avec des livrables démontrables à chaque itération. La matrice des risques identifie les points de vigilance clés, notamment la dépendance à l'API SAP Sandbox et la qualité des données pour l'entraînement ML. Des stratégies de mitigation concrètes ont été définies pour chacun d'eux.

Les choix architecturaux et méthodologiques étant désormais fixés, les chapitres suivants détailleront la modélisation technique du schéma de données, l'implémentation des services backend CAP, les algorithmes de Machine Learning développés, et les mécanismes de déploiement sur SAP BTP.
