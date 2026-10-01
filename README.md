# CELLTREE

**Tracker local, moteur de règles, simulateur et visualiseur** d'une stratégie expérimentale de gestion de
bankroll organisée en arbre de branches (« cellules »).

Chaque branche est une bankroll indépendante : elle naît avec un capital et un profil, joue des rounds
successifs (1 round = 1 ticket = **un seul match** sur Winamax), récolte vers une **BANK** sécurisée,
crée des branches filles, peut devenir **mature** à son plafond et finit par **mourir** — sans jamais
disparaître de l'historique.

> **Note de sécurité — rien n'est automatisé.** CELLTREE ne se connecte pas à Winamax, ne place aucun
> pari, ne clique rien, n'effectue aucun dépôt et ne contourne aucune limite. Tous les tickets sont
> placés **manuellement** sur Winamax puis saisis dans l'application. L'application calcule, recommande
> des montants selon les règles enregistrées, suit, simule et visualise. Elle fonctionne intégralement en
> local (aucun SaaS, aucun compte, aucun service cloud, aucune donnée envoyée).

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Stack](#stack)
3. [Installation et lancement](#installation-et-lancement)
4. [Scripts](#scripts)
5. [Base de données](#base-de-données)
6. [Tests](#tests)
7. [Architecture](#architecture)
8. [Règles métier](#règles-métier)
9. [Modèle de données](#modèle-de-données)
10. [Sauvegarde et restauration](#sauvegarde-et-restauration)
11. [UX, accessibilité, performance](#ux-accessibilité-performance)
12. [Limitations et fonctionnalités reportées](#limitations-et-fonctionnalités-reportées)

---

## Fonctionnalités

| Écran                                                                      | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard** (`/dashboard`)                                               | BANK en métrique principale (compteur animé), valeur totale de l'écosystème avec séparation stricte _sécurisé_ vs _à risque_, capital actif, branches vivantes/mortes/matures, tickets, win rate, cote et mise moyennes, total récolté, total perdu, net sécurisé, CLV moyenne, courbe BANK, branches dans le temps, répartition par profil, activité récente.                                                                                            |
| **Tree** (`/tree`)                                                         | Arbre hiérarchique React Flow : zoom, pan, fit view, recherche + recentrage, focus sur une lignée, collapse/expand des descendants, filtres (statut, profil, génération, plage de capital), taille des nœuds (uniforme / capital / lifetime value, échelle racine carrée), orientation verticale/horizontale, minimap, légende permanente, tooltip au survol, **voyage dans le temps** (slider sur le journal d'événements).                              |
| **Network** (`/network`)                                                   | Vue organique d3-force : liens parent→enfant uniquement, générations en anneaux, légère dérive des branches vivantes, branches mortes figées, _Freeze layout_, _Re-layout_, surbrillance d'une lignée.                                                                                                                                                                                                                                                    |
| **Drawer de branche** (clic sur un nœud, partout)                          | Panneau latéral (bottom sheet sur mobile). Onglets **Overview** (prochain palier avec progression), **Rounds** (timeline chronologique des tickets avec leurs conséquences : récolte, BANK, enfant créé, plafond, mort), **Events** (journal technique + contrôle du ledger), **Children**, **Stats**. Actions : _New round_, _Settle_, lignée, pause/reprise, sécuriser vers la BANK, ajustement manuel, notes, changement de profil exceptionnel.       |
| **Tickets** (`/tickets`)                                                   | Journal filtrable (date, branche, profil, sport, statut, plage de cotes, recherche texte), tri, pagination, export CSV, cartes sur mobile. Détail d'un ticket : CLV, checklist protocole, conséquences, édition journalisée, annulation d'un ticket en attente, **revert** d'un règlement erroné.                                                                                                                                                         |
| **New round / Settle**                                                     | Création en 2 étapes (branche ACTIVE ou MATURE → formulaire) avec calcul en direct (capital, mise, cote, retour et profit potentiels), mise proposée selon la stratégie, avertissements, **protection même match** (bloquant par défaut, override explicite et journalisé). Règlement avec **aperçu complet avant validation** : avant / résultat / après, split déclenché, BANK, enfant créé (profil modifiable), reliquat de la mère, mort ou maturité. |
| **BANK** (`/bank`)                                                         | Total sécurisé, aujourd'hui / 7 j / 30 j / total, courbe cumulée, provenance par branche et par profil, destination patrimoniale (non affecté, Livret A, PEA, CTO, autre — informative), timeline filtrable, CSV.                                                                                                                                                                                                                                         |
| **Branches** (`/branches`, `/branches/[code]`, `/branches/[code]/lineage`) | Table triable de toutes les branches, page détaillée, **lignée** (ancêtres → branche → descendants) avec capital cumulé, BANK cumulée, vivantes/mortes, meilleure branche, rounds.                                                                                                                                                                                                                                                                        |
| **Analytics** (`/analytics`)                                               | Comparaison HARVEST / BALANCED / GROWTH (moyenne **et médiane**), win rate global et par sport, tranche de cote, profil, compétition ; break-even `1/odds`, intervalle de Wilson à 95 %, edge affiché seulement au-delà d'un échantillon minimum configurable.                                                                                                                                                                                            |
| **Candidates** (`/candidates`)                                             | _Shadow portfolio_ : matchs analysés mais non joués (WATCH / ELIGIBLE / REJECTED), checklist, résultat, CLV, statistiques à mise plate, conversion en ticket en un clic.                                                                                                                                                                                                                                                                                  |
| **Simulation** (`/simulation`)                                             | Monte Carlo local dans un **Web Worker**, qui réutilise le vrai moteur de règles : médiane, moyenne, P25/P75/P90/P95 de la BANK, probabilités d'atteindre 1 000 / 5 000 / 10 000 / 50 000 €, probabilité d'extinction, branches survivantes, éventail de percentiles dans le temps. Seed reproductible, annulable, jusqu'à 100 000 runs.                                                                                                                  |
| **Settings** (`/settings`)                                                 | Toute la stratégie, centralisée et versionnée (historique des réglages), export/import JSON, exports CSV, outils de développement.                                                                                                                                                                                                                                                                                                                        |
| **Activity** (`/activity`)                                                 | Flux paginé des événements (gains, pertes, récoltes, BANK, naissances, morts…).                                                                                                                                                                                                                                                                                                                                                                           |
| **Command palette**                                                        | `Ctrl+K` : nouveau ticket, chercher une branche, BANK, graphe, créer une branche, simulation…                                                                                                                                                                                                                                                                                                                                                             |

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript strict** (`noUncheckedIndexedAccess`)
- **Tailwind CSS 4** (tokens CSS, thème sombre prioritaire + thème clair)
- **SQLite** via **better-sqlite3** + **Drizzle ORM** (migrations versionnées avec drizzle-kit)
- **Zod 4** (validation de toutes les entrées, des réglages et des sauvegardes)
- **@xyflow/react** (React Flow) + **d3-hierarchy** pour l'arbre, **d3-force / d3-zoom** pour le réseau
- **Recharts** pour les graphiques, **Radix UI** (dialogues, onglets, menus, tooltips), **cmdk**, **lucide-react**
- **Vitest** + **React Testing Library**, **ESLint** (config Next + règles React Compiler), **Prettier**

## Installation et lancement

Prérequis : **Node.js ≥ 22** (LTS) et npm. Aucune autre dépendance système (le binaire SQLite est fourni par
`better-sqlite3`).

```bash
npm install
npm run db:migrate   # crée ./data/celltree.db et applique les migrations (optionnel : fait aussi au démarrage)
npm run db:seed      # optionnel : charge le jeu de démonstration dans une base vide
npm run dev          # http://localhost:3000
```

Au premier lancement sur une base vide, le dashboard propose **Create root branch** ou **Load demo data**.

Production locale :

```bash
npm run build
npm run start        # http://localhost:3000
```

## Scripts

| Script                                    | Rôle                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                             | Serveur de développement                                                      |
| `npm run build` / `npm run start`         | Build et serveur de production                                                |
| `npm run lint`                            | ESLint (zéro avertissement toléré)                                            |
| `npm run typecheck`                       | `tsc --noEmit`                                                                |
| `npm run test` / `npm run test:watch`     | Vitest                                                                        |
| `npm run format` / `npm run format:check` | Prettier                                                                      |
| `npm run db:migrate`                      | Applique les migrations versionnées (`./drizzle`)                             |
| `npm run db:seed`                         | Charge la démo **uniquement si la base est vide**                             |
| `npm run db:reset`                        | Efface le ledger puis recharge la démo (refusé si `NODE_ENV=production`)      |
| `npm run db:generate`                     | Génère une nouvelle migration après modification de `src/server/db/schema.ts` |

## Base de données

- Fichier par défaut : `./data/celltree.db` (ignoré par git). Modifiable avec `CELLTREE_DB_PATH`
  (voir `.env.example`).
- Pragmas : WAL, clés étrangères activées, `busy_timeout`.
- Le schéma n'est **jamais** créé à la main : il provient des migrations versionnées de `./drizzle`
  (appliquées par `npm run db:migrate` et automatiquement au premier accès du serveur).
- Contraintes de sécurité au niveau SQL : montant BANK strictement positif, capital ≥ 0, mise > 0,
  cote > 1, **un seul ticket en attente par branche** (index unique partiel), codes de branche uniques.

## Tests

```bash
npm run test
```

136 tests (unitaires, intégration SQLite en mémoire, composants) couvrent notamment :

- arithmétique monétaire : 100 € @1.30 → 130 €, enchaînement 100 → 130 → 169 → 219,70 → 285,61, arrondi,
  absence d'erreurs de flottants ;
- **P1** : 285,61 → 100 € BANK + 100 € enfant + 85,61 € mère ; déclencheurs `TARGET_PATH`,
  `CAPITAL_MULTIPLE`, `WIN_COUNT` ; cotes réelles inférieures à 1.30 ;
- paliers post-P1 par profil, conservation des centimes, paliers au-delà du plafond ignorés ;
- **plafond** : 5 000 € @1.30 → 6 500 €, principal 5 000 €, 750 € BANK + 750 € enfant ;
- perte (branche morte), perte avec mise partielle, **void** (capital restauré, round non compté) ;
- création de branches et codes, transactions BANK, **protection même match**, limites journalières ;
- **rollback** complet d'un split si une écriture échoue (collision de code simulée) ;
- revert d'un règlement, ajustements manuels, changements de profil, pause ;
- **scénario d'acceptation §71 complet** (`src/server/services/services.test.ts`) ;
- sauvegarde : aller-retour export/import identique, rejet des fichiers incohérents ;
- statistiques (médiane, percentiles, Wilson, edge masqué sous l'échantillon minimum), Monte Carlo reproductible ;
- modèle de graphe (filtres, collapse, focus lignée, instantanés historiques), layout sans chevauchement ;
- composants React (checklist, badges accessibles) avec Testing Library.

## Architecture

```
src/
├── domain/                 # Logique métier PURE (aucun accès DB, testable seule)
│   ├── money/              # centimes, points de base, arrondi, parsing, formatage
│   ├── strategy/           # réglages (Zod, défauts), paliers/milestones, moteur de règles
│   ├── branches/           # codes A / A1 / A1.2, attribution de profil, lignée, métriques, ledger
│   ├── bets/               # règles de ticket (1 match), clé d'événement, CLV, tranches de cotes
│   ├── analytics/          # statistiques (moyenne, médiane, Wilson, synthèse tickets)
│   └── simulation/         # Monte Carlo (réutilise le moteur)
├── server/
│   ├── db/                 # schéma Drizzle, client SQLite, singleton Next
│   ├── services/           # cas d'usage transactionnels (branches, tickets, BANK, réglages, sauvegarde, démo)
│   ├── queries/            # read models sérialisables pour l'UI (DTO)
│   └── actions/            # Server Actions (validation, résultats typés, revalidation)
├── components/             # UI : primitives, graphes, drawer, dialogues, vues de pages
├── workers/                # Web Worker de simulation
└── app/                    # routes App Router (pages + API d'export/lecture)
drizzle/                    # migrations SQL versionnées
scripts/                    # db:migrate, db:seed
```

Flux d'un règlement : l'UI demande un **aperçu** (`previewSettlementAction`) → le service lit l'état et
appelle le moteur pur `evaluateSettlement(branch, ticket, result, settings, ctx)` qui renvoie un **plan
déterministe** (nouveau capital, statut, compteurs, transferts BANK, enfants, événements) → après
confirmation, `settleTicket` réévalue et **persiste le plan dans une seule transaction SQLite**.

## Règles métier

### Argent et arrondis

- Tous les montants sont des **centimes entiers** (100 € = 10 000). Cotes, pourcentages et multiples sont
  des **points de base** entiers (1.30 = 13 000 ; 25 % = 2 500 ; 2,8561 × S = 28 561).
- Chaque produit pouvant créer des fractions de centime est calculé exactement (BigInt) et arrondi **une
  seule fois** au centime le plus proche, demi éloigné de zéro.
- Les répartitions n'arrondissent jamais indépendamment : la dernière part est le reste, la somme des
  parts est toujours exactement le total.
- Helpers : `calculateReturn`, `calculateProfit`, `applyBp`, `roundMoney`, `parseMoney`, `formatMoney`
  (`src/domain/money`).

### Deux univers séparés : capital actif et BANK

L'argent envoyé en BANK **ne revient jamais** dans les branches : aucune fonction ne débite la BANK, la
base refuse les montants négatifs, et une branche morte ne peut pas être ressuscitée par la BANK. La
destination (Livret A, PEA, CTO…) est purement informative.

### P1 (première récolte, commune à tous les profils)

S = capital de naissance. À P1 : **S × 1 → BANK**, **S × 1 → nouvelle branche**, le reste demeure dans la
mère (multiples configurables). Déclencheur configurable :

| Mode                   | Déclenche quand…                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TARGET_PATH` (défaut) | le capital atteint la valeur qu'aurait S après N victoires à la cote cible, avec le même arrondi que les vrais tickets (1.30 × 4 → 285,61 € pour S = 100 €) |
| `CAPITAL_MULTIPLE`     | capital ≥ S × multiple                                                                                                                                      |
| `WIN_COUNT`            | N victoires, quelles que soient les cotes réelles                                                                                                           |

Dans tous les modes, la mère doit garder au moins `minMotherRemaining × S` (10 % par défaut). Les tickets
réels utilisent toujours leur **cote réelle** : à 1.25, P1 arrive simplement plus tard.

### Paliers post-P1 par profil (défauts V1)

| Profil   | Paliers (× S)   | BANK | Enfant | Reste | Plafond  |
| -------- | --------------- | ---- | ------ | ----- | -------- |
| HARVEST  | 4, 8, 16, 32…   | 25 % | 25 %   | 50 %  | 2 500 €  |
| BALANCED | 6, 12, 24, 48…  | 20 % | 20 %   | 60 %  | 5 000 €  |
| GROWTH   | 10, 20, 40, 80… | 15 % | 15 %   | 70 %  | 10 000 € |

- Les pourcentages s'appliquent au **capital réel** au moment du palier (qui dépasse souvent le seuil).
- Ordre d'évaluation après un gain : **P1** → **paliers du profil strictement inférieurs au plafond**
  (plusieurs peuvent se déclencher dans le même round, boucle bornée) → **plafond**.
- Une part enfant inférieure au minimum configurable (1 € par défaut) est envoyée en BANK au lieu de créer
  une branche « poussière ».

### Plafond et maturité

Une branche ACTIVE qui atteint son plafond devient **MATURE** : son principal reste au plafond et
l'excédent est réparti **50 % BANK / 50 % nouvelle branche** (configurable). Une branche mature rejoue son
plafond à chaque round (mise proposée = plafond) et ne déclenche plus ni P1 ni paliers. Le plafond est
**figé sur la branche à sa naissance** (les nouveaux réglages s'appliquent aux nouvelles branches ; un
changement de profil exceptionnel peut appliquer le nouveau plafond).

### Perte, void, rounds

- **Perte** d'une mise égale au capital : capital 0, statut **DEAD**, `diedAt`, événement `DEATH`. La mort est
  définitive ; la branche reste visible avec tout son historique.
- **Mise partielle** (autorisée avec avertissement) : en cas de perte, le reliquat non misé reste dans la
  branche, qui reste vivante — aucun centime ne disparaît du ledger.
- **VOID** : capital restauré, `voids++`, le compteur de rounds n'avance pas (réglable). Le prochain ticket
  reprend donc le même numéro de round.
- Un round est propre à chaque branche ; l'âge se mesure en rounds, pas en jours. Les jours sans pari ne
  sont jamais une erreur.

### Profils et naissances

- Profil choisi à la création d'une racine ; pour les enfants : attribution **QUOTA** déterministe (le
  profil le plus en retard sur la distribution 50/35/15 parmi les branches créées automatiquement), ou
  aléatoire pondérée, ou héritée — et toujours modifiable dans l'aperçu de règlement.
- Le profil ne change jamais automatiquement ; un changement manuel exceptionnel exige une raison et crée
  un événement `PROFILE_CHANGED`.
- Codes lisibles : racines `A`, `B`, … `Z`, `AA` ; enfants `A1`, `A2` ; puis `A1.1`, `A1.2`, `A1.2.3`. Les
  rangs ne sont jamais réutilisés. Les UUID restent internes.

### Tickets et protections

- **1 ticket = 1 match unique**, Winamax uniquement (`bookmaker = WINAMAX`). La confirmation « single
  match » est obligatoire et les noms d'événement ressemblant à un combiné (`A - B + C - D`) sont rejetés.
- Un seul ticket en attente par branche (la branche engage son capital).
- **Même match sur deux branches** : détecté sur le nom normalisé (accents, casse, « vs »/« - ») + jour du
  match. Bloqué par défaut ; contournement uniquement avec confirmation explicite et raison journalisée
  (ou simple avertissement si la politique est `WARN`).
- Limites optionnelles : tickets en attente simultanés, tickets par jour. Plage de cotes du protocole
  (avertissement).

### Auditabilité (event sourcing léger)

Chaque changement significatif crée un `BranchEvent` (`BIRTH`, `BET_CREATED`, `BET_WON`, `BET_LOST`,
`BET_VOID`, `BET_CANCELLED`, `HARVEST`, `BANK_TRANSFER`, `SPLIT`, `CHILD_CREATED`, `CAP_REACHED`,
`PROFILE_CHANGED`, `STATUS_CHANGED`, `MANUAL_ADJUSTMENT`, `DEATH`) avec un **delta de capital signé** et le
capital après l'événement. La somme des deltas d'une branche doit égaler son capital : c'est vérifié et
affiché dans l'onglet _Events_ (« Ledger balanced ») et à chaque import de sauvegarde.

### Corrections

Pas de modification silencieuse d'un ticket réglé :

- ticket en attente saisi par erreur → **annulation** (soft delete, journalisée) ;
- mauvais résultat → **revert du règlement** (remet le ticket en attente et restaure exactement la branche,
  événement `MANUAL_ADJUSTMENT`), possible seulement si c'est le dernier ticket de la branche et qu'il n'a
  créé ni enfant, ni transfert BANK, ni maturité ;
- autres cas → **ajustement manuel** du capital (raison obligatoire, journalisé) ;
- les champs descriptifs restent éditables ; l'édition de l'identité d'un ticket réglé est journalisée.
  Mise, cote et résultat ne sont jamais éditables directement.

### Indicateurs

- **Lifetime value** = capital actuel + total envoyé en BANK + capital donné aux enfants (reste visible après la mort).
- **Total ecosystem value** = BANK + capital des branches vivantes, toujours présenté avec la distinction
  sécurisé / à risque.
- **Net secured** = BANK − capital externe injecté dans les racines.
- **CLV** = cote prise / cote de clôture − 1 (ratio de prix ; la marge du bookmaker n'est pas retirée,
  documenté dans `src/domain/bets/tickets.ts`).

## Modèle de données

| Table                                    | Contenu                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branches`                               | id (UUID), code, parent, génération, profil, statut, raison et ticket de naissance, capital de naissance / actuel / pic, plafond, état P1 et niveau de palier, totaux BANK / enfants / pertes, victoires, défaites, voids, rounds, nombre d'enfants, dates (création, maturité, mort, dernier round), notes |
| `bets`                                   | tickets : branche, séquence, numéro de round, sport, compétition, match, clé d'événement normalisée, équipes, marché, sélection, bookmaker, cote, mise, retour potentiel/réel, P/L, capital avant/après, cote de clôture, protocole, confiance, checklist JSON, raison d'override, annulation               |
| `bank_transactions`                      | entrées BANK (toujours positives) : branche, ticket, type (`HARVEST`, `MATURE_PROFIT`, `MANUAL`), nature de récolte, profil d'origine, destination, notes                                                                                                                                                   |
| `branch_events`                          | journal ordonné (id auto-incrémenté), type, montant, delta de capital, capital et statut après, ticket et branche liés, métadonnées JSON, description                                                                                                                                                       |
| `candidates`                             | shadow portfolio (archivage en soft delete)                                                                                                                                                                                                                                                                 |
| `strategy_settings` / `settings_history` | réglages courants (JSON validé) et versions précédentes                                                                                                                                                                                                                                                     |

## Sauvegarde et restauration

- **Settings → Export backup (JSON)** : export complet et fidèle (montants en centimes, dates en ms).
- **Import** : validation stricte (format, types, unicité, références, et capital de chaque branche
  ré-expliqué par ses événements). Une base non vide exige de taper `REPLACE`, et une **copie de sécurité
  des données actuelles** est écrite d'abord dans `data/backups/`. Rien n'est jamais écrasé silencieusement.
- **Exports CSV** : tickets, branches, BANK (UTF-8 avec BOM, séparateur virgule, décimales avec point).
- Outils de développement (uniquement en `npm run dev`) : _Reset demo data_, _Wipe all data_ — chacun écrit
  une sauvegarde de sécurité avant d'agir.

## UX, accessibilité, performance

- Thème sombre prioritaire, thème clair disponible (préférence en cookie, sans flash). Palette des profils
  (vert / bleu / violet) validée pour les déficiences de vision des couleurs ; le statut n'est jamais porté
  par la couleur seule (badges texte + icônes : couronne mature, crâne mort, pause).
- Navigation clavier, libellés ARIA, focus visibles, `prefers-reduced-motion` respecté (pop de naissance,
  halo de maturité, fondu de mort, flash d'arête, compteur BANK, dérive du réseau).
- Responsive : cartes verticales, drawer → bottom sheet, tables → cartes ou défilement maîtrisé.
- Performance : layout de l'arbre mémoïsé, nœuds React Flow mémoïsés, rendu limité aux nœuds visibles au-delà
  de 250 nœuds, collapse et filtres pour les très grands arbres, positions du réseau mises à jour hors du
  cycle React, simulation hors du thread principal, journal des tickets paginé côté serveur.

## Limitations et fonctionnalités reportées

- **Recalcul en cascade** d'un ticket réglé ayant déjà produit un split : non proposé (choix de sécurité) ;
  passer par le revert (si autorisé) ou un ajustement manuel journalisé.
- **Voyage dans le temps** : le slider rejoue capital et statut de chaque branche ; les totaux BANK/enfants
  affichés sur les nœuds ne sont pas historisés (masqués en mode historique).
- **Capture d'écran de ticket** : colonne `screenshot_path` prévue, upload non implémenté.
- Les modifications de réglages s'appliquent aux évaluations futures ; les plafonds déjà figés sur les
  branches existantes ne sont pas recalculés.
- La devise est un paramètre d'affichage (pas de conversion).
- Sur mobile, le tooltip du graphe est remplacé par le tap qui ouvre le panneau de la branche.
- `npm audit` signale une vulnérabilité modérée dans une dépendance de **développement** de drizzle-kit
  (esbuild du serveur de dev d'esbuild-kit) ; elle n'est pas embarquée dans l'application.
- Node.js ≥ 22 requis (better-sqlite3 13).
