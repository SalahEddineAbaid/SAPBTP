# Chapitre 2 : Étude d’analyse et de conception du projet

## 1. Introduction
Ce chapitre constitue la transition logique entre l'étude préliminaire et la réalisation concrète de notre solution SmartOrder. Après avoir défini le contexte général, cerné la problématique et fixé les objectifs dans le premier chapitre, il est à présent question d'entrer dans le cœur technique et fonctionnel du projet.

L'objectif de ce chapitre est quadruple :
- **Analyser le fonctionnement du système** existant pour en comprendre les limites.
- **Modéliser les interactions** entre les différents acteurs et le futur système pour répondre aux besoins exprimés.
- **Concevoir l'architecture technique** globale et détaillée (microservices, bases de données, sécurité).
- **Préparer l'implémentation** en fournissant tous les plans nécessaires au développement, notamment l'intégration du module d'intelligence artificielle.

---

# PARTIE I — Étude d’analyse

## 2. Étude de l’existant
Pour proposer une solution pertinente, il est indispensable de comprendre comment la gestion des commandes est actuellement opérée avant l'implémentation de SmartOrder.

### 2.1 Fonctionnement actuel
Dans le cadre actuel, la gestion s'appuie sur une utilisation classique de l'ERP SAP (notamment SAP S/4HANA). Le processus se caractérise par :
- **Une gestion SAP classique** : Les commandes sont saisies et traitées via les transactions standards de SAP.
- **Un suivi manuel des commandes** : Les gestionnaires doivent régulièrement extraire des rapports ou vérifier individuellement le statut des commandes pour s'assurer de leur bon acheminement.
- **Une consultation via des interfaces SAP standards** (ex: SAP GUI ou Fiori de base), qui, bien que robustes, ne sont pas toujours optimisées pour une prise de décision rapide ou un suivi proactif des anomalies de la chaîne logistique.

### 2.2 Limites du système actuel
Ce fonctionnement "traditionnel", bien qu'éprouvé, présente plusieurs limitations majeures face aux exigences modernes de la Supply Chain :
- **Absence d’anticipation** : Le système est réactif et non proactif. Les retards ne sont constatés qu'une fois qu'ils ont eu lieu.
- **Manque d’intelligence analytique** : Les données historiques sont stockées mais très peu exploitées pour dégager des tendances ou prédire des comportements futurs (ex: fiabilité d'un fournisseur).
- **Pas d’alertes temps réel** : Les gestionnaires ne sont pas notifiés instantanément des anomalies bloquantes ; ils doivent aller chercher l'information.
- **Difficulté de consolidation** : Les vues globales croisant plusieurs indicateurs de performance manquent de flexibilité.
- **Dépendance aux traitements manuels** : Les processus de relance et de vérification requièrent un temps humain considérable et fastidieux, source d'erreurs et de retards.

### 2.3 Solution proposée
Face à ces constats, le projet **SmartOrder** est proposé. Il s'agit d'une application moderne visant à transformer la gestion des commandes d'une approche réactive à une approche prédictive et intelligente. Fonctionnellement, la solution se définit par :
- **Une extension SAP BTP (Business Technology Platform)** : Permettant de garder le cœur SAP S/4HANA propre (Clean Core) tout en ajoutant des fonctionnalités avancées en "Side-by-Side extensibility".
- **Une architecture cloud-native** : Assurant haute disponibilité, scalabilité et intégration fluide des différents services.
- **Une intelligence artificielle intégrée** : Un module de Machine Learning chargé d'analyser les données historiques pour prédire les risques de retards de livraison.
- **Des dashboards interactifs** : Offrant une visualisation claire, ergonomique et en temps réel de l'état des commandes et des KPI.
- **Des alertes intelligentes** : Un système de notification proactif basé sur les prédictions de l'IA et des règles métier définies.

## 3. Analyse fonctionnelle du système
Cette section détaille les fonctionnalités que le futur système doit offrir pour répondre aux limites identifiées, en capitalisant sur les besoins évoqués en introduction.

### 3.1 Identification des acteurs
Le système SmartOrder interagit avec plusieurs entités, humaines ou systèmes :

| Acteur | Description |
| :--- | :--- |
| **USER (Utilisateur métier / Logisticien)** | Acteur principal qui utilise l'application au quotidien pour la consultation des commandes, le suivi de leurs statuts et la réception des alertes de premier niveau. |
| **MANAGER (Responsable Supply Chain)** | Supervise les opérations globales, accède aux tableaux de bord analytiques avancés, valide certaines décisions critiques (ex: annulation/réaffectation de commande) et suit les KPI. |
| **ADMIN (Administrateur système)** | En charge de l'administration technique : gestion des utilisateurs, des rôles, et supervision technique (logs, état des services ML et BTP). |
| **SAP S/4HANA** | Système externe, source de vérité (Backend). Il fournit les données brutes des commandes, fournisseurs et articles, et reçoit d'éventuelles mises à jour. |
| **Service ML (Machine Learning)** | Composant technique autonome qui consomme les données pour entraîner ses modèles et fournit les prédictions (scores de risque de retard) via API. |

### 3.2 Diagramme de cas d’utilisation global
*Le diagramme de cas d'utilisation global illustre les principales interactions entre les acteurs identifiés et le système SmartOrder.*

*(Insérer ici l'image du diagramme de cas d'utilisation global)*

### 3.3 Description détaillée des cas d’utilisation

Cette section détaille sous forme de tableaux les scénarios des principaux cas d'utilisation identifiés dans le diagramme.

#### 1. Se connecter
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Se connecter |
| **Acteur principal** | User, Manager, Admin |
| **Description** | Permet à l'utilisateur de s'authentifier de manière sécurisée pour accéder au système SmartOrder via SSO (SAP XSUAA). |
| **Préconditions** | L'utilisateur possède un compte actif au sein de l'entreprise. |
| **Scénario nominal** | 1. L'utilisateur accède à l'URL de l'application.<br>2. Le système le redirige vers la page d'authentification SAP.<br>3. L'utilisateur saisit ses identifiants.<br>4. Le système valide et lui octroie l'accès avec les droits correspondant à son rôle. |
| **Postconditions** | L'utilisateur est connecté et est redirigé vers sa page d'accueil (tableau de bord ou liste des commandes). |

#### 2. Consulter commandes
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Consulter commandes |
| **Acteur principal** | User, Manager |
| **Description** | Permet de visualiser la liste globale des commandes importées depuis SAP S/4HANA. |
| **Préconditions** | L'utilisateur est authentifié. |
| **Scénario nominal** | 1. L'utilisateur navigue vers l'onglet des commandes.<br>2. Le système récupère les données à jour depuis le backend.<br>3. Le système affiche la liste sous forme de tableau. |
| **Postconditions** | La liste des commandes est affichée à l'écran. |

#### 3. Filtrer commandes
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Filtrer commandes |
| **Acteur principal** | User, Manager |
| **Description** | Permet de réduire la liste des commandes affichées en appliquant des critères spécifiques (statut, fournisseur, niveau de risque IA). |
| **Préconditions** | L'utilisateur est sur la vue "Consulter commandes". |
| **Scénario nominal** | 1. L'utilisateur sélectionne un ou plusieurs filtres (ex: "Commandes en retard").<br>2. L'utilisateur valide sa recherche.<br>3. Le système actualise la liste selon les critères choisis. |
| **Postconditions** | Seules les commandes correspondant aux filtres sont affichées. |

#### 4. Voir détail commande
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Voir détail commande |
| **Acteur principal** | User, Manager |
| **Description** | Permet d'afficher l'ensemble des informations détaillées d'une commande spécifique, incluant les articles et informations fournisseurs. |
| **Préconditions** | L'utilisateur consulte la liste des commandes. |
| **Scénario nominal** | 1. L'utilisateur clique sur une ligne de commande spécifique dans la liste.<br>2. Le système interroge le backend pour les détails de cette commande.<br>3. Le système affiche la page des détails. |
| **Postconditions** | Les informations détaillées de la commande sont affichées à l'écran. |

#### 5. Consulter prédictions IA
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Consulter prédictions IA |
| **Acteur principal** | Manager (et User via l'affichage des détails) |
| **Description** | Permet de visualiser l'évaluation de l'Intelligence Artificielle concernant le risque de retard pour une ou plusieurs commandes. |
| **Préconditions** | Le modèle ML a généré une prédiction pour la commande consultée. |
| **Scénario nominal** | 1. L'utilisateur accède aux détails d'une commande.<br>2. Le système interroge le service ML (historique ou temps réel).<br>3. Le système affiche le score de risque sous forme visuelle (ex: jauge ou couleur). |
| **Postconditions** | L'utilisateur a pris connaissance du niveau de risque évalué par l'IA. |

#### 6. Recevoir alertes en temps réel
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Recevoir alertes en temps réel |
| **Acteur principal** | User, Manager |
| **Description** | Notifie pro-activement l'utilisateur des anomalies ou risques de retard identifiés par le système sur les commandes suivies. |
| **Préconditions** | L'utilisateur est connecté et le système tourne en arrière-plan. |
| **Scénario nominal** | 1. Le système détecte un changement de statut critique ou un score de risque élevé (ML).<br>2. Le système génère une alerte.<br>3. Une notification "push" apparaît sur l'interface de l'utilisateur.<br>4. L'utilisateur clique pour consulter l'alerte. |
| **Postconditions** | L'utilisateur est alerté de la situation anormale et le système trace la lecture de l'alerte. |

#### 7. Modifier statut commande
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Modifier statut commande |
| **Acteur principal** | Manager |
| **Description** | Permet au Manager d'intervenir manuellement sur une commande pour forcer ou changer son statut suite à une décision métier. |
| **Préconditions** | Le Manager affiche les détails d'une commande. |
| **Scénario nominal** | 1. Le Manager sélectionne une action (ex: annuler, bloquer, marquer expédiée).<br>2. Le système demande une confirmation.<br>3. Le Manager valide.<br>4. Le système met à jour le statut en base et notifie SAP. |
| **Postconditions** | Le statut de la commande est mis à jour, ce qui peut potentiellement déclencher une alerte. |

#### 8. Exporter données CSV
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Exporter données CSV |
| **Acteur principal** | Manager |
| **Description** | Permet de télécharger les données des commandes sous format CSV pour des analyses externes (Excel, BI). |
| **Préconditions** | Le Manager visualise une liste de commandes (filtrée ou non). |
| **Scénario nominal** | 1. Le Manager clique sur le bouton d'export CSV.<br>2. Le système génère un fichier contenant les données affichées.<br>3. Le fichier est proposé au téléchargement.<br>4. Le Manager télécharge le fichier localement. |
| **Postconditions** | Un fichier de données CSV est généré et stocké sur le poste de l'utilisateur. |

#### 9. Consulter dashboard
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Consulter dashboard |
| **Acteur principal** | Manager |
| **Description** | Affiche les indicateurs clés de performance (KPI), graphiques et résumés des opérations Supply Chain pour aider à la prise de décision. |
| **Préconditions** | Le Manager est authentifié. |
| **Scénario nominal** | 1. Le Manager navigue vers le tableau de bord.<br>2. Le système agrège les données récentes.<br>3. Le système rend les graphiques et KPI à l'écran. |
| **Postconditions** | Les statistiques globales sont visibles par le Manager. |

#### 10. Analyser anomalies
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Analyser anomalies |
| **Acteur principal** | Manager |
| **Description** | Permet de creuser dans les données pour comprendre les causes profondes de retards récurrents ou de problèmes fournisseurs. |
| **Préconditions** | Des données d'anomalies sont remontées par le système. |
| **Scénario nominal** | 1. Le Manager accède à l'outil d'analyse (ou à un rapport spécifique).<br>2. Le système liste les problèmes fréquents par catégorie/fournisseur.<br>3. Le Manager explore ces données pour préparer des actions correctives. |
| **Postconditions** | Les causes d'anomalies sont identifiées pour prise de décision. |

#### 11. Gérer utilisateurs et rôles
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Gérer utilisateurs et rôles |
| **Acteur principal** | Admin |
| **Description** | Permet d'administrer les accès au système SmartOrder, d'ajouter des utilisateurs et de leur affecter des rôles (User, Manager, Admin). |
| **Préconditions** | L'Admin est authentifié avec les privilèges requis. |
| **Scénario nominal** | 1. L'Admin accède à la console d'administration des utilisateurs.<br>2. Il sélectionne ou crée un utilisateur.<br>3. Il lui attribue les droits adéquats et sauvegarde.<br>4. Le système enregistre les modifications dans la gestion des accès. |
| **Postconditions** | Les droits d'accès de l'utilisateur sont mis à jour et effectifs. |

#### 12. Consulter logs système
| Champ | Description |
| :--- | :--- |
| **Nom du cas d'utilisation** | Consulter logs système |
| **Acteur principal** | Admin |
| **Description** | Permet de visualiser l'historique technique et les événements de l'application (logs d'erreurs, activité, requêtes). |
| **Préconditions** | L'Admin est authentifié. |
| **Scénario nominal** | 1. L'Admin navigue vers l'interface de monitoring technique.<br>2. Le système récupère les journaux d'événements (logs).<br>3. L'Admin filtre ou recherche des erreurs spécifiques pour diagnostic. |
| **Postconditions** | Les événements du système sont consultés à des fins de débogage ou de sécurité. |

---

# PARTIE II — Étude de conception

## 4. Conception générale
Cette phase traduit les besoins fonctionnels en spécifications techniques et définit l'ossature du système.

### 4.1 Architecture globale
La solution SmartOrder s'appuie sur une architecture distribuée et moderne, tirant parti de l'écosystème SAP BTP et de technologies Open Source pour garantir performance, sécurité et évolutivité.

*(Insérer ici l'image de l'architecture globale)*

L'architecture est composée de plusieurs briques interagissant ensemble :

- **Navigateur Utilisateur** *(Client Frontend)* : Interface Homme-Machine (IHM), rendu dynamique (SPA - React). Interface web permettant aux différents acteurs (User, Manager, Admin) de consulter les commandes, les prédictions et les alertes.
- **SAP AppRouter** *(Point d'entrée & Routage)* : Point d'entrée unique, intégration OIDC, routage des requêtes HTTP. Redirige les utilisateurs non authentifiés vers SAP XSUAA et route les requêtes vers le Backend Express ou le HTML5 Repository de manière transparente.
- **SAP XSUAA** *(Gestion des Identités)* : Sécurité, authentification OAuth2, génération de tokens JWT, gestion des rôles. Sécurise l'accès global à SmartOrder, vérifie l'identité des utilisateurs d'entreprise et contrôle l'accès selon les rôles (Admin, Manager, User).
- **HTML5 Repository** *(Hébergement Frontend)* : Stockage et distribution des ressources statiques (HTML, CSS, JS). Héberge les fichiers compilés de l'application web (React) pour qu'ils soient servis de façon optimisée par l'AppRouter.
- **Backend Express JS** *(Cœur Transactionnel)* : API REST, orchestration de la logique métier, gestion des WebSockets. Traite les requêtes du frontend, récupère les données de l'ERP, orchestre les appels au service ML, et pousse les alertes en temps réel via WebSocket.
- **Python / FastAPI** *(Service d'IA (Machine Learning))* : Inférence rapide, API REST, exécution de modèles Scikit-learn. Microservice dédié qui exécute les modèles de Machine Learning (Classification / Régression) pour évaluer et prédire les risques de retard des commandes.
- **PostgreSQL on BTP** *(Base de données locale)* : Stockage relationnel persistant, requêtes SQL performantes. Stocke les historiques des prédictions, les alertes générées, les données de configuration métier et met en cache certaines informations pour accélérer l'affichage.
- **Destination Service** *(Connecteur Sécurisé)* : Gestion centralisée des connexions aux systèmes distants. Permet au Backend Express JS de se connecter de façon sécurisée à SAP ERP via des configurations gérées par la plateforme (sans identifiants codés en dur).
- **App Logging** *(Monitoring & Traçabilité)* : Collecte, agrégation et consultation des journaux d'événements. Trace de manière centralisée les requêtes, les opérations et les éventuelles erreurs du Backend et du service ML pour la maintenance et l'audit.
- **SAP ERP** *(Source de vérité / Backend Externe)* : Gestion logistique et commerciale de l'entreprise. Fournit les données transactionnelles et de base brutes (commandes, fournisseurs) exposées via des API OData v4.

### 4.2 Architecture microservices
Pour répondre aux exigences de flexibilité et de scalabilité propres aux applications cloud-native :
- **Séparation des services** : Le Backend métier (CAP), le Frontend et le service d'Intelligence Artificielle sont développés, déployés et mis à l'échelle de manière indépendante.
- **Communication API REST & OData** : Le Frontend communique avec le Backend CAP principalement via OData v4. Le Backend CAP interroge SAP S/4HANA via OData (ou REST), et communique avec le service ML FastAPI via des requêtes REST (JSON).
- **WebSocket** : Envisagé pour pousser les alertes en temps réel vers le navigateur de l'utilisateur sans rechargement (push notifications).

## 5. Conception UML
Cette section présente la modélisation orientée objet du système, garantissant une implémentation logicielle structurée.

### 5.1 Diagrammes de séquence
Ils décrivent la chronologie des échanges de messages entre les différents composants (Frontend, Backend, Service ML, Base de données, etc.). Pour illustrer la valeur ajoutée de SmartOrder, nous détaillons ici la cinématique des trois cas d'utilisation les plus stratégiques de l'application :

#### 1. Diagramme de séquence : Consulter prédictions IA
Ce diagramme illustre comment le système interroge le modèle de Machine Learning en temps réel pour évaluer le risque sur une commande.
1. **Navigateur** : L'utilisateur (Manager) clique sur une commande pour en voir les détails. Une requête HTTP GET est envoyée.
2. **SAP AppRouter** : Intercepte la requête, valide le token JWT de l'utilisateur, et route la demande vers le Backend Express JS.
3. **Backend Express JS** : Interroge la base **PostgreSQL** pour récupérer les données brutes de la commande et du fournisseur.
4. **Backend Express JS** : Envoie une requête REST (POST) contenant les caractéristiques (features) de la commande au microservice **Python / FastAPI**.
5. **FastAPI (Service ML)** : Fait passer les données dans le modèle Scikit-learn, calcule le score de risque de retard et le retourne au Backend.
6. **Backend Express JS** : Sauvegarde ce score de prédiction dans **PostgreSQL** (pour l'historique) et renvoie les données consolidées au Navigateur.
7. **Navigateur** : Affiche les détails de la commande avec une représentation visuelle du score de risque IA.

*(Insérer ici l'image du diagramme de séquence : Consulter prédictions IA)*

#### 2. Diagramme de séquence : Recevoir alertes en temps réel
Ce diagramme montre le fonctionnement proactif du système, capable de notifier l'utilisateur sans qu'il n'ait à rafraîchir sa page.
1. **Backend Express JS** : Un job planifié (Cron) interroge **SAP ERP** via le **Destination Service** pour récupérer les derniers statuts de commandes.
2. **SAP ERP** : Retourne les commandes ayant subi des changements récents.
3. **Backend Express JS** : Pour les commandes critiques, il demande une nouvelle évaluation au service **FastAPI** (ML).
4. **FastAPI (Service ML)** : Renvoie un score indiquant un niveau de risque "Élevé".
5. **Backend Express JS** : Détecte l'anomalie, génère un objet "Alerte", et l'enregistre dans **PostgreSQL**.
6. **Backend Express JS** : Pousse l'alerte en temps réel via une connexion **WebSocket** active vers le client.
7. **Navigateur** : Intercepte le message WebSocket et affiche immédiatement une notification "Push" sur l'écran de l'utilisateur.

*(Insérer ici l'image du diagramme de séquence : Recevoir alertes en temps réel)*

#### 3. Diagramme de séquence : Analyser anomalies
Ce diagramme met en évidence l'exploitation des données stockées pour fournir une vue macroscopique aux décideurs.
1. **Navigateur** : Le Manager navigue vers le tableau de bord analytique. Le Frontend demande les statistiques agrégées.
2. **SAP AppRouter** : Route la requête vers le Backend.
3. **Backend Express JS** : Formule des requêtes SQL complexes d'agrégation (jointures entre les commandes, les alertes et l'historique ML) et les envoie à **PostgreSQL**.
4. **PostgreSQL** : Exécute les requêtes et retourne les indicateurs de performance (KPIs) et les données regroupées (ex: retards par fournisseur).
5. **Backend Express JS** : Formate les résultats au format JSON et les renvoie au Navigateur.
6. **Navigateur** : Utilise ces données pour générer et rendre les graphiques interactifs permettant l'analyse des causes profondes.

*(Insérer ici l'image du diagramme de séquence : Analyser anomalies)*

### 5.2 Diagramme de classes
Le diagramme de classes représente la structure statique du système. Les principales classes sont :
- **Order (Commande)** : ID, Date, Montant, Statut, ID_Fournisseur, Score_Risque, Date_Livraison_Prevue.
- **Supplier (Fournisseur)** : ID, Nom, Pays, Fiabilite_Historique.
- **Alert (Alerte)** : ID, ID_Order, Type, Message, Niveau_Severite, Date_Creation.
- **Prediction (Historique de prédiction)** : ID, ID_Order, Score, Date_Prediction, Modele_Version.
- **User (Utilisateur)** & **Role (Rôle)** : Pour la gestion des accès.

*(Insérer ici l'image du diagramme de classes)*

### 5.3 Diagramme d’activités
Il décrit le cheminement du traitement, particulièrement utile pour le cycle de vie d'une commande.
- **Cycle de traitement d’une commande** : Création/Récupération -> Évaluation par le modèle ML -> Si le score de risque dépasse un certain seuil, déclenchement de la génération d'alerte et notification du Manager, sinon poursuite du suivi normal de la livraison.

*(Insérer ici l'image du diagramme d'activités)*

### 5.4 Diagramme d’états-transitions
Ce diagramme est très pertinent pour le suivi d'une commande dans SmartOrder. Les états principaux d'une entité **Order** sont :
- **CREATED** : Commande fraîchement créée et intégrée au système.
- **VALIDATED** : Commande confirmée.
- **IN_PROGRESS** : En cours de préparation ou d'expédition.
- **DELAYED** : État déclenché (par le système ML ou suite à une confirmation) indiquant un retard avéré ou prédictif.
- **DELIVERED** : Commande réceptionnée.
- **CANCELLED** : Commande annulée.

*(Insérer ici l'image du diagramme d'états-transitions)*

## 6. Conception de la base de données
La persistance des données repose sur une modélisation rigoureuse.

### 6.1 Modèle conceptuel des données (MCD)
Il décrit les entités fondamentales (Commande, Fournisseur, Alerte) et leurs associations sémantiques (Une commande est rattachée à un fournisseur, elle peut générer plusieurs alertes), sans considération technologique.

*(Insérer ici l'image du MCD)*

### 6.2 Modèle logique des données (MLD)
Traduction du MCD en tables relationnelles destinées à PostgreSQL, incluant les clés primaires (PK), clés étrangères (FK) et les types de données spécifiques.

*(Insérer ici l'image du MLD)*

### 6.3 Modélisation CDS SAP CAP
Dans le contexte de SAP CAP, le modèle de données est défini en langage **CDS (Core Data Services)**. C'est un élément central pour le projet. Ce modèle permet de générer automatiquement le schéma physique PostgreSQL et d'exposer l'API OData correspondante, tout en intégrant les annotations de sécurité et de UI.

## 7. Conception de la sécurité
La sécurité est primordiale pour une application d'entreprise accédant aux données d'un ERP.
- **SAP XSUAA** : Service SAP BTP assurant la gestion des identités et des accès.
- **OAuth2 & JWT (JSON Web Token)** : Les flux d'authentification reposent sur OAuth2. Le JWT est utilisé comme "Bearer Token" pour sécuriser chaque communication entre le Frontend, l'Approuter et le Backend CAP.
- **RBAC (Role-Based Access Control)** : Le contrôle d'accès est basé sur les rôles de l'utilisateur.
- **Rôles USER / MANAGER / ADMIN** : Les autorisations sont déclarées finement au niveau des services CDS CAP, permettant par exemple de restreindre l'édition des alertes aux seuls Managers ou l'administration aux Admins.

## 8. Conception du module Machine Learning
Cette partie constitue l'innovation majeure de l'application SmartOrder.

### 8.1 Pipeline ML
Le cycle de vie de la donnée pour l'intelligence artificielle suit un pipeline strict :
1. **Préparation des données** : Nettoyage et formatage des données historiques.
2. **Entraînement** : Apprentissage du modèle sur les données passées pour identifier les motifs de retard.
3. **Validation** : Mesure de la performance et de la précision du modèle.
4. **API de Prédiction** : Mise en production du modèle au sein du microservice FastAPI pour traiter les nouvelles données en temps réel.

### 8.2 Modèles utilisés
Deux approches analytiques sont envisagées :
- **Classification** : Pour prédire une catégorie de risque (ex: Risque de retard "Oui" / "Non", ou catégorisation Faible/Moyen/Élevé).
- **Régression** : Pour estimer une valeur numérique continue (ex: prédire le nombre de jours de retard exacts).

### 8.3 Flux de prédiction
Le fonctionnement opérationnel est le suivant :
1. **Données SAP** : Récupération des détails d'une commande.
2. **FastAPI** : Le Backend CAP envoie les caractéristiques de la commande (features) via une requête HTTP au microservice ML (FastAPI).
3. **Retour Score de risque** : Le modèle ML effectue l'inférence et retourne instantanément un score probabiliste que le système utilise pour statuer sur le statut de la commande ou déclencher des alertes.

## 9. Conclusion
Ce chapitre a permis d'établir une fondation solide pour la réalisation du projet SmartOrder. L'étude de l'existant a confirmé la pertinence de la solution proposée, et l'analyse fonctionnelle a précisé les besoins des utilisateurs et du système. La phase de conception a ensuite traduit ces besoins en une architecture technique moderne (microservices, SAP BTP, PostgreSQL, CAP), une modélisation des données précise et des diagrammes UML détaillés. Enfin, la conception intégrée de la sécurité et l'architecture spécifique du module de Machine Learning garantissent la viabilité d'un système intelligent. Ces spécifications constituent le cahier des charges opérationnel qui guidera la phase de réalisation et d'implémentation, objet du chapitre suivant.
