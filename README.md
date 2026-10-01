# CELLTREE

**Tracker local, moteur de règles, simulateur et visualiseur** d'une stratégie expérimentale de gestion de
bankroll organisée en arbre de branches (« cellules »).

Chaque branche est une bankroll indépendante : elle naît avec un capital et un profil, joue des rounds
successifs (1 round = 1 ticket = **un seul match** sur Winamax, avec **tout son capital**), récolte vers une
**BANK** sécurisée, crée des branches filles, peut devenir **mature** à son plafond et finit par **mourir** —
sans jamais disparaître de l'historique.

> **Note de sécurité — rien n'est automatisé.** CELLTREE ne se connecte pas à Winamax, ne place aucun
> pari, ne clique rien, n'effectue aucun dépôt, n'augmente aucune limite et n'en contourne aucune. Tous les
> tickets sont placés **manuellement** sur Winamax puis saisis dans l'application. L'application calcule,
> applique les règles enregistrées, suit, simule et visualise. Elle fonctionne intégralement en local (aucun
> SaaS, aucun compte, aucun service cloud, aucune donnée envoyée).

---

## Sommaire

1. [Nouveautés V1.1](#nouveautés-v11)
2. [Installation et lancement](#installation-et-lancement)
3. [Scripts](#scripts)
4. [Espaces de travail REAL et DEMO](#espaces-de-travail-real-et-demo)
5. [Stockage : fichiers JSON validés](#stockage--fichiers-json-validés)
6. [Sauvegardes, restauration, annulation](#sauvegardes-restauration-annulation)
7. [Règles V1 de la stratégie](#règles-v1-de-la-stratégie)
8. [BANK : SECURED et WITHDRAWN](#bank--secured-et-withdrawn)
9. [Corrections et suppressions](#corrections-et-suppressions)
10. [Versionnement de la stratégie](#versionnement-de-la-stratégie)
11. [Import / export et migration V1.0](#import--export-et-migration-v10)
12. [Fonctionnalités](#fonctionnalités)
13. [Stack](#stack)
14. [Architecture](#architecture)
15. [Modèle de données](#modèle-de-données)
16. [Tests](#tests)
17. [UX, accessibilité, performance](#ux-accessibilité-performance)
18. [Limitations](#limitations)

---

## Nouveautés V1.1

- **Plus de base de données.** SQLite, better-sqlite3, Drizzle et les migrations ont disparu. Chaque espace de
  travail est un **fichier JSON versionné et validé** (`data/<workspace>/state.json`), écrit de façon
  **atomique** (fichier temporaire → fsync → renommage) à travers une file de mutations.
- **Deux espaces isolés : REAL et DEMO.** REAL démarre vide et n'est jamais pré-rempli ; DEMO contient le jeu de
  démonstration et peut être réinitialisé à volonté. Un sélecteur permanent, un badge `REAL DATA` et un bandeau
  `DEMO / SIMULATION DATA` indiquent en permanence quelles données sont affichées.
- **Snapshots automatiques** avant chaque changement annulable, historique des sauvegardes, **Undo** du dernier
  changement (« Last change: … [Undo] »), restauration d'un snapshot quelconque.
- **Règles V1 appliquées strictement en REAL** : P1 à **2,80 × S**, mise = **tout le capital**, cote
  **≤ 1,30**, **une branche par match**, **un seul jalon post-P1 par round gagné**. En DEMO, chaque écart est
  possible mais explicite, journalisé et étiqueté _Outside V1_.
- **BANK** : statut `SECURED` / `WITHDRAWN`, date de retrait, destination ; l'argent ne revient jamais dans
  l'arbre.
- **Corrections « DELETE / REBUILD FROM THIS POINT »** avec aperçu d'impact, snapshot préalable, archivage par
  défaut et suppression définitive sur confirmation tapée.
- **Versionnement de la stratégie** (`strategyVersion` 1.0 + révision) enregistré sur chaque branche et ticket.

## Installation et lancement

Prérequis : **Node.js ≥ 22** et npm. Aucune dépendance native, aucune base à installer.

```bash
npm install
npm run dev          # http://localhost:3000
```

Au premier lancement, l'espace **REAL** est vide : tous les montants valent 0,00 €, les moyennes affichent
« — » et les graphiques un état vide. Pour explorer l'application avec des données fictives : sélecteur
**DEMO** (barre latérale) → **Initialize demo data**. Les fichiers ne sont créés qu'à la première écriture.

Production locale :

```bash
npm run build
npm run start        # http://localhost:3000
```

Variable optionnelle : `CELLTREE_DATA_DIR` (dossier des espaces, `./data` par défaut — voir `.env.example`).

## Scripts

| Script                                    | Rôle                               |
| ----------------------------------------- | ---------------------------------- |
| `npm run dev`                             | Serveur de développement           |
| `npm run build` / `npm run start`         | Build et serveur de production     |
| `npm run lint`                            | ESLint (zéro avertissement toléré) |
| `npm run typecheck`                       | `tsc --noEmit`                     |
| `npm run test` / `npm run test:watch`     | Vitest                             |
| `npm run format` / `npm run format:check` | Prettier                           |

Il n'y a plus de `db:migrate`, `db:seed`, `db:generate` ni `db:reset` : l'initialisation et la
réinitialisation de DEMO se font depuis l'interface, et REAL n'est jamais pré-rempli.

## Espaces de travail REAL et DEMO

|                     | REAL                                                    | DEMO                                                           |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Fichier             | `data/real/state.json` + `data/real/backups/`           | `data/demo/state.json` + `data/demo/backups/`                  |
| Contenu initial     | **vide** (jamais de données de démo)                    | vide, puis **Initialize demo data**                            |
| Règles V1           | **strictes** (aucun contournement)                      | mêmes règles, contournement explicite et journalisé possible   |
| Actions spécifiques | **Reset REAL workspace** (taper `RESET REAL`, snapshot) | **Initialize demo data**, **Reset DEMO** (recrée le seul DEMO) |
| Indicateur          | badge vert `REAL DATA`                                  | badge `DEMO DATA` + bandeau `DEMO / SIMULATION DATA`           |

- Le choix de l'espace affiché est une **préférence d'interface** (cookie `celltree-workspace`). Changer d'espace
  ne lit ni n'écrit aucune donnée : il n'existe pas de « workspace courant » global côté serveur.
- **Chaque action et chaque lecture nomme explicitement son espace** : les Server Actions reçoivent le workspace
  affiché par la page, les routes API un paramètre `?ws=REAL|DEMO`.
- Un fichier appartenant à l'autre espace est refusé au chargement ; un état REAL portant le marqueur de démo est
  refusé à l'écriture ; aucun bouton ne charge la démo dans REAL ; un fichier DEMO ne peut pas être importé dans
  REAL.

## Stockage : fichiers JSON validés

Format (`src/server/state/schema.ts`) :

```jsonc
{
  "format": "celltree-state",
  "schemaVersion": 1,
  "workspace": "REAL",
  "strategyVersion": "1.0",
  "savedAt": "2026-10-01T18:00:00.000Z",
  "settings": { … },            // toute la stratégie, validée par Zod
  "settingsHistory": [ … ],     // versions précédentes des réglages
  "branches": [ … ], "bets": [ … ], "bankTransactions": [ … ], "branchEvents": [ … ], "candidates": [ … ],
  "archive": [ … ],             // enregistrements retirés par une correction (mode archive)
  "metadata": { "createdAt", "nextEventId", "strategyRevision", "mutationCount", "demoSeed", "lastChange" }
}
```

Conventions : montants en **centimes entiers**, cotes et ratios en **points de base** (1,30 = 13 000), dates en
millisecondes epoch, jours de match `AAAA-MM-JJ`.

Cycle d'écriture (`FileStateRepository`, `src/server/state/repository.ts`) :

1. file de mutations **par espace** (les opérations concurrentes sont sérialisées) ;
2. chargement de l'état courant (mis en cache, **gelé** en lecture) puis copie de travail ;
3. application de l'opération métier sur la copie — une exception abandonne simplement la copie ;
4. **validation d'intégrité complète** (`src/server/state/integrity.ts`) : schéma Zod strict, unicité des ids et
   des codes, parents et tickets de naissance existants, pas d'orphelin, un seul ticket en attente par branche,
   capital de chaque branche = Σ des deltas de ses événements, statut/compteurs/P1/paliers/profil/plafond
   **rejoués depuis le journal** (`replay.ts`), totaux BANK et enfants cohérents, aucune transaction BANK sans
   branche ni ticket (« BANK fantôme »), cohérence `WITHDRAWN` ↔ date de retrait, marqueur de démo interdit en
   REAL ;
5. snapshot automatique éventuel de l'état précédent, puis écriture `state.tmp` → `fsync` → `rename` sur
   `state.json`.

Un état invalide n'est **jamais** écrit : `state.json` reste intact. Un fichier corrompu au chargement n'est pas
utilisé : l'interface affiche les problèmes détectés et propose de restaurer un snapshot (le fichier rejeté est
déplacé à côté, jamais supprimé).

## Sauvegardes, restauration, annulation

- **Snapshots automatiques** dans `data/<workspace>/backups/AAAA-MM-JJTHH-mm-ss-SSS.json`, pris avant chaque
  changement annulable (création, règlement, annulation, correction, ajustement, transfert, statut BANK,
  réglages, import, reset, restauration). Seuls les **50 plus récents** sont conservés (réglable :
  _Settings → Automatic snapshots kept_).
- **Sauvegardes manuelles** (`…-manual.json`, avec note) : **jamais supprimées** par la rétention.
- **Settings → Backups & snapshots** : historique (type, raison, date, taille), restauration de n'importe quel
  snapshot, **Restore previous snapshot**. Une restauration prend d'abord un snapshot de l'état courant : elle
  est elle-même annulable.
- **Undo** : la barre supérieure affiche « Last change: … [Undo] ». Annuler restaure le snapshot pris juste avant
  ce changement (les éventuels changements ultérieurs sont signalés avant confirmation).

## Règles V1 de la stratégie

Toutes les valeurs vivent dans les réglages (`src/domain/strategy/settings.ts`) ; le moteur de règles
(`src/domain/strategy/engine.ts`) est pur et déterministe.

### Argent et arrondis

- Montants en **centimes entiers**, cotes/pourcentages/multiples en **points de base** entiers.
- Produits calculés exactement (BigInt) et arrondis **une seule fois** au centime (demi éloigné de zéro) ;
  les répartitions donnent la dernière part au reste, la somme est toujours exacte.

### Tickets

- **1 ticket = 1 seul match**, **Winamax uniquement** (non négociable). Confirmation « single match » obligatoire,
  noms ressemblant à un combiné refusés.
- **Mise = tout le capital** de la branche ACTIVE ; pour une branche MATURE, le **principal plafonné**. En REAL
  le champ est verrouillé ; si Winamax n'accepte pas le montant, la branche attend — aucun ticket n'est
  obligatoire.
- **Cote maximale 1,30** (bloquante en REAL). Cote minimale du protocole 1,18 (avertissement). Couloirs
  **informatifs** par profil : HARVEST 1,18–1,24, BALANCED 1,22–1,27, GROWTH 1,25–1,30.
- **Une branche par match** : même match (nom normalisé + jour) déjà en attente sur une autre branche → refusé en
  REAL ; contournement explicite possible en DEMO (ou simple avertissement si la politique est `WARN`).
- Un seul ticket en attente par branche. Limites personnelles optionnelles (tickets simultanés, par jour),
  contournables avec raison.
- En **DEMO**, mise partielle, cote > 1,30 et même match sont possibles uniquement via une section explicite
  « Experiment outside the V1 rules » (case à cocher + raison) ; le ticket reste marqué **Outside V1**.
- Le même module (`src/domain/bets/policy.ts`) est utilisé par le formulaire et par le serveur.

### P1 (première récolte)

S = capital de naissance. Déclencheur par défaut **`CAPITAL_MULTIPLE` : capital ≥ 2,80 × S** ; alors
**1 × S → BANK**, **1 × S → nouvelle branche**, le reste demeure dans la mère (au moins 10 % de S).
`TARGET_PATH` et `WIN_COUNT` restent disponibles comme alternatives explicites.

Exemple (test d'acceptation) : 100 € → 130 → 169 → 219,70 → 285,61 € (≥ 280 €) ⇒ BANK 100 €, enfant A1 100 €,
mère 85,61 €.

### Paliers post-P1, plafond, maturité

| Profil   | Paliers (× S)   | BANK | Enfant | Reste | Plafond  |
| -------- | --------------- | ---- | ------ | ----- | -------- |
| HARVEST  | 4, 8, 16, 32…   | 25 % | 25 %   | 50 %  | 2 500 €  |
| BALANCED | 6, 12, 24, 48…  | 20 % | 20 %   | 60 %  | 5 000 €  |
| GROWTH   | 10, 20, 40, 80… | 15 % | 15 %   | 70 %  | 10 000 € |

- **Un seul jalon post-P1 par round gagné** : P1 s'il n'est pas fait, sinon au plus **un** palier (le suivant).
  Une branche encore au-dessus du palier suivant le récoltera à un round gagné ultérieur — jamais de cascade.
- Les pourcentages s'appliquent au capital réel au moment du palier. Une part enfant sous le minimum (1 €) part
  en BANK.
- Au **plafond**, la branche devient **MATURE** : principal maintenu au plafond, excédent réparti 50 % BANK /
  50 % nouvelle branche. Le plafond est figé sur la branche à sa naissance.

### Perte, void, rounds

- Un ticket perdu (mise = tout le capital) **tue la branche** : capital 0, `DEAD`, événement `DEATH`. La branche
  morte reste dans l'arbre, le réseau et tout l'historique.
- **VOID** : capital restauré, round non compté (réglable).
- L'âge d'une branche se mesure en rounds ; chaque round garde son historique complet (onglet _Rounds_).

## BANK : SECURED et WITHDRAWN

- Toute entrée BANK est d'abord **SECURED** : sortie définitive de l'écosystème, même si l'argent est encore sur
  le solde Winamax.
- **Mark as withdrawn** (par entrée, ou en lot sur la liste filtrée ; la date du retrait est enregistrée) →
  **WITHDRAWN** ; **Undo withdrawn** corrige une erreur ; **Set destination** (Livret A, PEA, CTO, autre —
  informatif).
- Le dashboard et la page BANK affichent **TOTAL SECURED**, **WITHDRAWN** et **AWAITING WITHDRAWAL**.
- Aucune opération ne débite la BANK vers une branche ; ces statuts ne touchent jamais au capital des branches.

## Corrections et suppressions

Workflow destructif générique (`src/server/services/correction-service.ts`, dialogue
`src/components/corrections/correction-dialog.tsx`) : **aperçu d'impact** (exécution à blanc + contrôle
d'intégrité) → **snapshot automatique** → **confirmation explicite**.

- Les champs descriptifs d'un ticket restent éditables ; l'édition de l'identité d'un ticket réglé est
  journalisée. Mise, cote et résultat ne sont **jamais** modifiés en place.
- **Reopen (wrong result)** : le ticket redevient en attente ; ses conséquences et tout ce qui a suivi sur la
  branche sont retirés, la branche est **reconstruite depuis son journal**.
- **Delete from here** (ticket réglé) : supprime ce ticket et tout ce qui suit sur sa branche, avec les
  **sous-arbres entiers** des branches nées de cette partie et l'argent BANK qu'ils ont produit — ni orphelin,
  ni BANK fantôme. L'aperçu signale l'argent déjà retiré (`WITHDRAWN`).
- Supprimer un ticket en attente ou annulé ne retire que ce ticket (il n'a jamais déplacé d'argent).
- Onglet _Events_ : **Delete from here** sur un ajustement manuel, un transfert BANK manuel, un changement de
  profil ou de statut.
- **Racine** : _Delete root & subtree_. Une branche enfant se supprime depuis son ticket de naissance.
- **Candidats** : archivage ou suppression définitive.
- **Mode** : **Archive** (défaut — les enregistrements sont retirés du registre et conservés dans `archive`) ou
  **suppression définitive** (taper le code de la branche ou `DELETE`). Les archives peuvent être purgées
  (`DELETE`). Toute correction est journalisée sur la branche reconstruite et annulable via Undo.

## Versionnement de la stratégie

- `strategyVersion` (baseline **1.0** = règles V1 définitives) et une **révision** incrémentée à chaque
  modification d'une règle de stratégie (les préférences d'affichage et de rétention ne la changent pas).
- Chaque branche et chaque ticket enregistrent la version et la révision sous lesquelles ils ont été créés ;
  l'historique n'est jamais réinterprété. Les réglages précédents sont conservés dans `settingsHistory`.

## Import / export et migration V1.0

- **Export** (Settings ou `/api/export/backup?ws=…`) : fichier `celltree-backup` portant l'identité de son espace.
- **Import** : validation complète (schéma + intégrité). Un fichier **DEMO est toujours refusé dans REAL** (y
  compris un fichier relabellisé contenant le marqueur de démo) ; un fichier REAL ne peut entrer dans DEMO
  qu'en cochant **import as a copy**. Remplacer des données existantes exige de taper `REPLACE` ; un snapshot est
  pris avant.
- **Migration V1.0** : un export JSON de l'ancienne version SQLite est reconnu et converti (statut BANK
  `SECURED`, stratégie 1.0, réglages remis aux défauts V1.1). Un export contenant le jeu de démo est traité comme
  DEMO. Aucune dépendance SQLite n'est nécessaire.
- **CSV** : tickets, branches, BANK (avec statut et date de retrait), par espace.

## Fonctionnalités

| Écran                                                                      | Contenu                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard** (`/dashboard`)                                               | BANK total sécurisé (retiré / en attente de retrait), valeur totale de l'écosystème (sécurisé vs à risque), capital actif, branches, tickets, win rate, cote et mise moyennes, CLV, courbes, profils, activité — états vides explicites. |
| **Tree** (`/tree`)                                                         | Arbre React Flow : zoom, recherche, focus lignée, collapse, filtres, tailles, orientation, minimap, légende, branches mortes visibles, **voyage dans le temps**.                                                                         |
| **Network** (`/network`)                                                   | Vue organique d3-force, générations en anneaux, branches mortes figées.                                                                                                                                                                  |
| **Drawer de branche**                                                      | Onglets Overview, **Rounds** (historique complet de chaque round), **Events** (journal + ledger + _Delete from here_), Children, Stats ; actions et corrections.                                                                         |
| **Tickets** (`/tickets`)                                                   | Journal filtrable et paginé, badge _Outside V1_, CSV ; détail avec CLV, checklist, conséquences, **Reopen**, **Delete from here**.                                                                                                       |
| **New round / Settle**                                                     | Formulaire V1 (mise verrouillée en REAL, cote ≤ 1,30, une branche par match), aperçu complet du règlement avant validation.                                                                                                              |
| **BANK** (`/bank`)                                                         | Total sécurisé / retiré / en attente, statut par entrée, retrait individuel ou en lot, destination, provenance, courbe, CSV.                                                                                                             |
| **Branches** (`/branches`, `/branches/[code]`, `/branches/[code]/lineage`) | Table de toutes les branches, page détaillée, lignée.                                                                                                                                                                                    |
| **Analytics**, **Candidates**, **Simulation**                              | Statistiques (médianes, Wilson, échantillon minimum), shadow portfolio, Monte Carlo local en Web Worker.                                                                                                                                 |
| **Settings** (`/settings`)                                                 | Stratégie de l'espace affiché, « Workspace storage: REAL — ./data/real/state.json », sauvegardes et snapshots, export/import, archives, DEMO init/reset, reset REAL.                                                                     |
| **Activity**, **Command palette** (`Ctrl+K`)                               | Flux paginé des événements ; navigation et actions rapides.                                                                                                                                                                              |

## Stack

- **Next.js 16** (App Router, Server Actions) · **React 19** · **TypeScript strict** (`noUncheckedIndexedAccess`)
- **Persistance** : fichiers JSON par espace, validés par **Zod 4**, écriture atomique (Node `fs`)
- **Tailwind CSS 4**, **Radix UI**, **cmdk**, **lucide-react**, **sonner**
- **@xyflow/react** + **d3-hierarchy** (arbre), **d3-force / d3-zoom** (réseau), **Recharts**
- **Vitest** + **React Testing Library**, **ESLint**, **Prettier**

## Architecture

```
src/
├── domain/                 # Logique métier PURE (aucune I/O)
│   ├── money/              # centimes, points de base, arrondi, parsing, formatage
│   ├── strategy/           # réglages (Zod, défauts V1), milestones, moteur de règles
│   ├── branches/           # codes A / A1 / A1.2, profils, lignée, métriques, ledger
│   ├── bets/               # tickets (1 match), clé d'événement, CLV, politique V1 (policy.ts)
│   ├── analytics/          # statistiques
│   └── simulation/         # Monte Carlo (réutilise le moteur)
├── server/
│   ├── state/              # schéma du fichier, intégrité, replay, FileStateRepository, sélection d'espace
│   ├── services/           # opérations pures sur un brouillon d'état (branches, tickets, BANK,
│   │                       #   corrections, réglages, import/export, démo)
│   ├── queries/            # read models sérialisables (DTO) calculés depuis l'état
│   └── actions/            # Server Actions : espace explicite, mutation atomique, Undo
├── components/             # UI
├── workers/                # Web Worker de simulation
└── app/                    # routes (pages + API de lecture/export avec ?ws=)
```

Flux d'une mutation : action (`workspace`, entrée) → `repository.mutate(workspace, fn, { undoable })` →
`fn` applique un service pur sur une copie de l'état → validation d'intégrité → snapshot → écriture atomique.
Flux d'un règlement : aperçu (`previewSettlementAction`, moteur pur `evaluateSettlement`) → confirmation →
application du plan sur la copie → persistance tout-ou-rien.

## Modèle de données

| Collection         | Contenu                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `branches`         | id, code, parent, génération, profil, statut, naissance (raison, ticket, événement, capital), capital actuel/pic, plafond, P1, palier, totaux, compteurs, dates, version de stratégie                        |
| `bets`             | ticket d'un seul match : séquence, round, événement normalisé, marché, sélection, Winamax, cote, mise, retours, capital avant/après, CLV, protocole, override, _outsideV1_, annulation, version de stratégie |
| `bankTransactions` | entrée BANK positive : branche, ticket, type, nature de récolte, profil d'origine, **statut SECURED/WITHDRAWN**, date de retrait, destination                                                                |
| `branchEvents`     | journal ordonné (`id` = ordre global) : type, montant, delta de capital signé, capital et statut après, liens, métadonnées, description                                                                      |
| `candidates`       | shadow portfolio (archivage possible)                                                                                                                                                                        |
| `archive`          | lots d'enregistrements retirés par une correction en mode archive                                                                                                                                            |

## Tests

```bash
npm run test
```

175 tests (unitaires, services sur état en mémoire, dépôt de fichiers sur dossier temporaire, composants) :

- arithmétique monétaire exacte ; **P1 à 2,80 × S** ; acceptation 100 → 130 → 169 → 219,70 → 285,61 ⇒ BANK 100,
  enfant 100, mère 85,61 ; mort après perte totale ; un seul jalon par round ;
- politique V1 : mise complète obligatoire en REAL, cote > 1,30 refusée, une branche par match, overrides DEMO
  explicites, branche mature au principal plafonné ;
- **isolation REAL/DEMO**, lecture sans écriture, reset DEMO sans effet sur REAL (octet pour octet), fichier d'un
  autre espace refusé, démo interdite dans REAL ;
- **persistance atomique**, état invalide jamais écrit (et aucun snapshot orphelin), opérations concurrentes
  sérialisées ;
- snapshots, rétention (manuels conservés), restauration, **Undo** (et annulation de l'undo) ;
- BANK SECURED ↔ WITHDRAWN sans effet sur les branches, montants négatifs rejetés ;
- corrections en cascade (reopen, delete from here, événement manuel, racine), absence d'orphelins et de BANK
  fantôme, archive vs purge et confirmations tapées ;
- import/export (DEMO → REAL refusé, REAL → DEMO en copie, fichier corrompu rejeté, migration V1.0), CSV ;
- tableau de bord REAL vide (zéros, « — »), branches mortes et historique du graphe ;
- statistiques, Monte Carlo reproductible, modèle de graphe, composants React.

## UX, accessibilité, performance

- Thème sombre prioritaire + clair ; le statut n'est jamais porté par la couleur seule (badges texte + icônes).
- Navigation clavier, libellés ARIA, focus visibles, `prefers-reduced-motion` respecté.
- Responsive (drawer → bottom sheet, tables → cartes) ; sélecteur d'espace dans le menu mobile, badge compact.
- États immuables mis en cache par espace (invalidation sur la date de modification du fichier), index de
  lecture mémoïsés, simulation hors du thread principal.

## Limitations

- Application mono-utilisateur locale : la file de mutations est en mémoire dans le processus Next ; ne pas
  lancer deux serveurs sur le même dossier de données.
- Les archives de corrections se consultent dans _Settings_ ; les remettre en place passe par Undo ou la
  restauration d'un snapshot.
- **Voyage dans le temps** : capital et statut rejoués ; les totaux BANK/enfants des nœuds ne sont pas historisés.
- Capture d'écran de ticket : champ prévu, upload non implémenté. La devise est un paramètre d'affichage.
