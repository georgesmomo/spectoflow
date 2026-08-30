# Journal de décisions — projet « spectoflow » (nom provisoire)

> Registre vivant. Chaque décision a un statut : **ACTÉ** (tranché), **DIFFÉRÉ** (repoussé, à revisiter),
> **OUVERT** (à trancher). On met à jour ce fichier à chaque session pour ne rien reperdre.
> Dernière mise à jour : session d'analyse initiale.

---

## Décisions actées

### D1 — Périmètre V1 = local, solo — mais architecture *collab-ready*
- **ACTÉ.** La V1 vise un usage **local, mono-utilisateur** (framework SDD + dashboard local, sans comptes ni cloud).
- **Raison :** c'est le *wedge* le plus défendable ; le prototype `/init-dashboard` le prouve déjà. Le cloud collaboratif est la partie la plus complexe, la plus coûteuse à maintenir et la moins défendable (cf. fermeture de l'offre payante de Vibe Kanban / Bloop en avril 2026).
- **Contrainte imposée par D3 :** même en local, le **modèle de données doit être collab-ready** dès la V1 (voir D4, D5), sinon le passage en équipe = réécriture.

### D2 — Le gate d'intention est gouverné par le MODE, borné par la POLICY (deux axes orthogonaux)
- **ACTÉ.** Le routeur d'intention classe la demande (Quick / Standard / Major) puis se comporte selon le **mode** :
  - **Autopilot** : classe et exécute sans confirmer le workflow.
  - **Semi (adaptatif)** : confirme seulement si ambiguïté / décision importante / risque. *Mode par défaut probable.*
  - **Manuel** : confirme chaque étape.
- **Borne indépendante — la POLICY de risque :** certains actes restent bloqués *quel que soit le mode* (déploiement prod, migration destructive, changement de sécurité). Le mode = friction de routine ; la policy = approbations non négociables.
- **Workflow Standard = TDD « standard entreprise » par défaut, mais flexible** (cas exploratoire/spike : tests possibles après un premier jet, mais **requis avant « done »**).
- **En semi, un Major est TOUJOURS confirmé**, même si la demande est parfaitement claire.

### D3 — Destination produit : public + utilisable en équipe
- **ACTÉ.** L'objectif final est un produit **rendu public**, utilisable par des **équipes**.
- **Conséquence :** confirme que le cloud/collaboratif est la destination (pas juste du multi-machine perso) → justifie la contrainte « collab-ready » de D1.

### D4 — Le dashboard est une surface d'écriture de plein droit ; invariant = opérations granulaires
- **ACTÉ (corrigé).** Depuis le dashboard, le **propriétaire** ajoute/édite tâches, sous-tâches, commentaires → **ça s'applique directement**. L'agent, quand il reprend le travail, **le prend en compte**. **Aucune re-validation en ligne de commande de ses propres éditions.**
- **Le flux « suggestion → validation » ne concerne QUE un tiers non-propriétaire** (ex. un manager) : ses apports arrivent en *draft*, le propriétaire valide avant intégration. La porte d'approbation dépend de l'**autorité (qui écrit)**, pas de la **surface (d'où ça vient)**. (C'était l'idée d'origine.)
- **Invariant qui rend la co-édition sûre :** on écrit par **opérations granulaires** (une tâche, un champ), jamais par réécriture du document entier → dashboard et agent éditent sans s'écraser.
- **Implémentation V1 (local) :** on garde le mécanisme du prototype (écritures granulaires + serveur qui relit le fichier avant chaque mutation). **Cloud-era :** le même invariant s'implémente via un log d'événements (bonus : historique/audit, multi-writer). Le log n'est **pas imposé à la V1** ; seul l'invariant granulaire l'est.

### D5 — Identité triple, jamais fusionnée
- **ACTÉ (principe, dès V1).** Trois entités distinctes : **humain** (compte / assignation), **machine/workspace** (lieu d'exécution), **runtime agent** (Claude / Codex / autre). Le token MCP les relie mais le modèle les garde séparées.

### D6 — MCP = canal de contrôle, pas canal de synchro de fichiers
- **ACTÉ (principe).** L'agent émet de petits événements via MCP (heartbeat, statut, commentaire). Le dashboard lit les artefacts lui-même (fichiers / git / cloud selon config). Jamais l'agent ne pousse les fichiers via le contexte.
- **Raison :** coût en tokens / « taxe de contexte » (problème documenté sur spec-kit).

### D7 — Routeur d'intention (le cœur du produit)
- **ACTÉ (modèle).** Pipeline interne : **Intake** (tâche connue / nouvelle demande / retouche ; override explicite ?) → **Classify** (Quick / Standard / Major) → **Gate** (selon le mode) → **Load** (chargement paresseux du seul workflow retenu) → **Run** (les gates de policy peuvent s'interposer à tout moment).
- **Classement sur 4 signaux — le niveau retenu = le plus haut déclenché :** portée · risque/réversibilité · ambiguïté · nouveauté. *Le risque peut forcer le niveau même pour un effort minuscule.*
- **Workflows (TDD encodé) :** Quick = comprendre→modifier→valider ; **Standard = standards de l'industrie, appliqués mais flexibles** (par défaut : analyser→planifier→tests→implémenter→exécuter→valider) ; Major = recherche→brainstorm→exigences→archi→ADR→plan→stratégie de tests→tests→implémentation→sécurité→QA→validation.
- **Verdict selon le mode (D2) :** autopilot applique et annonce ; semi confirme si ambigu/limite/risqué **et confirme toujours un Major, même clair** ; manuel confirme chaque étape. Override toujours possible, mais les gates de policy s'appliquent quand même.

### D7 — Lancer le dev = langage naturel, via un routeur dans CLAUDE.md + workflows en skills
- **ACTÉ.** Pas de commande obligatoire. On tape en langage naturel (« développe T-567 »). Un **routeur court dans `CLAUDE.md`** (relu à chaque session) déclenche : classification → confirmation selon le mode → exécution. Les **workflows sont des skills auto-invoqués** — description visible en permanence, corps chargé à la demande (= chargement paresseux, O1).
- **Échappatoire / override :** skills explicites `/dev`, `/quick`, `/standard`, `/major` (invocation directe fiable, indépendante du routeur).
- **Caveat de fiabilité :** les consignes de `CLAUDE.md` peuvent se « diluer » en session longue (context drift). → routeur court + prioritaire, et les skills explicites servent de filet.
- **Sous le capot :** capacités (reviewer/tests/sécurité) = subagents (isolation de contexte) ; traçabilité = hook ; synchro dashboard = MCP. Le `/init-dashboard` actuel devient l'installeur de tout ça.

---

## Décisions différées (à revisiter)

### DIFF1 — Cloud collaboratif complet (comptes, rôles, notifications, présence, messagerie, résolution de conflits)
- **DIFFÉRÉ après V1.** Destination confirmée (D3) mais hors périmètre V1 (D1). Sert de **contrainte de non-régression** sur le modèle de données, rien de plus, tant qu'on n'y est pas.

### DIFF2 — Modèle « source de vérité » multiple (code=git / artefacts SDD=local|cloud|git / collab=cloud / exécution=local)
- **DIFFÉRÉ.** Retenu comme cadre conceptuel (analyse OpenAI validée), mais on n'implémente en V1 que la branche **tout-local**.

### DIFF3 — Nom du produit
- **DIFFÉRÉ / à trancher tôt.** Risque de collision : « SpecFlow » est un outil BDD .NET connu (Tricentis / successeur Reqnroll). « spectoflow » reste dans la même zone sémantique → confusion + SEO difficile.

---

## Propositions statuées

- **O1 — Chargement paresseux des workflows — ACTÉ.** L'agent ne porte en permanence qu'un mini-routeur + l'index des workflows (leurs noms). Une tâche classée charge SEULEMENT la définition du workflow concerné. Une retouche Quick ne charge jamais le workflow Major. → workflows en fichiers séparés, chargés à la demande (pas de `CLAUDE.md` monolithique).
- **O2 — Routeur d'intention — ACTÉ (règle).** Classement **implicite par défaut**, l'utilisateur pouvant **forcer explicitement**. Signaux : verbe + portée + risque. Comportement du verdict selon le mode (D2). *Design fin de la classification = prochaine session.*
- **O3 — Capacités non-code — ACTÉ.** Les capacités sont une **palette**. À l'init, on détecte la nature du projet (code / infra / analyse / contenu) et on n'active que les capacités pertinentes. Un projet « étude » = recherche + analyse + rédaction, sans TDD ni security review.
- **O5 — Claim de tâche — ACTÉ (principe), activation collab.** Assignation ; si un autre veut prendre → notif « assigné à X, tu veux prendre ? » → si oui, réassignation + notif à X. Inactif en V1 solo.

### Sujets différés (cloud/collab)
- **O4 — Offline / cohérence.** Sans objet en V1 (tout local, aucun réseau agent↔dashboard). Cloud uniquement : file d'événements locale + rejeu à la reconnexion ; le dashboard affiche « vu il y a X min », jamais un faux « bloqué ».
- **O6 — Sécurité du token MCP.** Token = secret scopé (projet + droits), révocable, affiché une seule fois. Concerne le MCP/collab.

---

## Positionnement (rappel de contexte, non décisionnel)

- Deux familles existent : **frameworks SDD** (spec-kit / OpenSpec / BMAD — produisent des artefacts, **aveugles**, pas de vue de statut) et **dashboards d'orchestration d'agents** (Vibe Kanban / Conductor / Nimbalyst / AgentsRoom — surveillent des **sessions parallèles**, pas de méthodo SDD, pas de collaboration métier).
- **Whitespace visé :** l'intersection = *« un Linear/Jira pour du SDD agentique »* — control plane de niveau projet au-dessus d'artefacts SDD, avec état d'exécution temps réel. Personne ne l'occupe bien.

---

## Session 3 — Architecture v0.3 (validée)

### D8 — Storage: markdown artifacts + runtime sidecar
- **ACTÉ.** Artefacts (specs, plans, tasks) en **markdown** dans `specs/` et `plans/` à la racine du projet (versionnés, lisibles, standard — comme spec-kit/OpenSpec). Tâches = cases à cocher + tags. Le dashboard **parse** ces `.md` et écrit en **granulaire** (ligne par ligne).
- État d'exécution volatil (agent en cours, heartbeat, résultats de tests) → `.spectoflow/runtime.json`, **gitignoré** (JSON OK car non lu par l'humain). Reconnecte la séparation artefacts / état d'exécution.
- Convention de tâche : `- [ ] T-012 Title @owner ~level %status` ; commentaires en sous-puces.
- `init` sur projet existant : scanne les `.md`, ajoute les champs manquants (id/tag) sans détruire.

### D9 — Skills vs agents, et localisation
- **ACTÉ.** Agents = personas **stables** (le « qui ») ; skills = procédures **évolutives** (le « comment »). On améliore une skill sans toucher l'agent.
- Canonique dans **`.spectoflow/`** (source unique, swappable, propre) ; `init` **génère des shims minces par agent** (`.claude/`, `.codex/`, …) qui pointent vers le canonique. Patron confirmé par OpenSpec (adapters claude/codex/cursor/gemini/…).

### D10 — Workflow = fichier unique, éditable, par projet
- **ACTÉ.** Une seule source (`.spectoflow/workflow.md`) ; `AGENTS.md` et la commande ne font que la référencer (fin de la duplication). Le dashboard rend le pipeline en SVG animé ; désactiver/supprimer une étape édite le fichier.

### D11 — Dashboard temps réel + périmètre
- **ACTÉ.** Temps réel via **SSE + fs.watch** (zéro dépendance), fin du poll. Onglets : Board, Workflow (SVG), Agents/Skills, tests (pass/fail depuis runtime), quel agent.
- **v0.4 (différé, agréé)** : fenêtre de chat qui lance `claude -p` / `codex exec` en streaming avec la mémoire projet. Faisable : `claude -p` charge CLAUDE.md sauf `--bare`. (amux fait déjà ce type de flotte headless.)

### D12 — Agents à titres d'équipe
- **ACTÉ.** Product Manager · Business Analyst · Architect · Tech Lead · Developer/Senior Developer · QA Engineer · Security Engineer · Code Reviewer (+ UX Designer, DevOps à confirmer à l'usage).

### D13 — Nom & langue
- **ACTÉ.** Paquet npm **`spectoflow`** (libre). Commande `spectoflow`. **Alias court reporté** (`stf` pris = DeviceFarmer ; libres : `spkt`, cryptique).
- i18n : `.spectoflow/config` avec `language`, **anglais par défaut** (docs + commentaires de code), changeable.

---

## Session 4 — v0.4

### D14 — Versioning: semver (three numbers)
- **ACTÉ.** MAJOR.MINOR.PATCH. Pré-1.0 : feature → minor (0.4.0), fix → patch (0.4.1). Le nom du zip suit la version exacte.

### D15 — v0.4: agent launcher in the dashboard
- **ACTÉ.** Onglet "Run" : l'utilisateur tape une demande, le serveur lance l'agent en headless (`claude -p` / `codex exec`) dans la racine projet, **avec la mémoire projet** (CLAUDE.md → AGENTS.md), streame la sortie, et enregistre le run dans runtime.json. L'agent met à jour les `.md`, le board se rafraîchit en direct (watch).
- Commande **configurable** par `config.runners`. Sécurité : ne pas utiliser `--bare` (sinon la mémoire ne charge pas) ; permissions à la main de l'utilisateur (défaut `acceptEdits`, warning UI). Testé ici avec un agent **stub** (claude/codex non installés dans l'environnement de build).

---

## Session 5 — v0.5

### D16 — `spectoflow update` : ownership par manifeste + `.new` sidecar, pas de merge 3 voies en v1
- **ACTÉ.** `init` étant idempotent (ne réécrit jamais), il ne peut pas rafraîchir un projet installé. `spectoflow update` (+ `--dry-run`) rafraîchit les fichiers **framework-owned** vers la version du kit courant **sans jamais toucher** au travail de l'utilisateur. Usage : `npm update -g spectoflow` puis `spectoflow update` dans le projet.
- **Modèle d'appartenance (dérivé, pas codé en dur) :** framework-owned = **tous les fichiers de `templates/`** SAUF `config.json` et `workflow.md`. Ainsi l'ajout d'un agent/skill par défaut au kit est automatiquement couvert. User-owned (jamais lu en écriture) : `config.json`, `workflow.md` (édité depuis le dashboard), `specs/`, `plans/`, `runtime.json`, et tout agent/skill créé ou édité par l'utilisateur. Voir `lib/ownership.js`.
- **Détection par empreintes :** `init` écrit `.spectoflow/.manifest.json` (`{version, files:{rel: sha256}}`, `crypto` natif). Le manifeste est **commité** (pas gitignoré) → baseline partagée en équipe. Voir `lib/manifest.js`.
- **Matrice par fichier (`lib/update.js`) :** absent → *create* ; `disque == nouveau` → *unchanged* (ou *adopted* si legacy) ; `disque == baseline` (non édité) → *refresh* ; sinon (édité, ou legacy divergent) → **préserver + `<fichier>.new`**. Le manifeste est réécrit à la version courante ; un fichier divergé garde sa baseline d'origine pour rester signalé.
- **Legacy (installs sans manifeste, ex. `demo/`) :** dégradation prudente — si `disque == nouveau` on adopte (mise sous suivi), sinon on préserve + `.new` (ambigu : impossible de distinguer « édité » de « framework périmé »).
- **Hors périmètre v1 (différé) :** merge 3 voies automatique ; suppression des fichiers retirés d'une version ; merge additif de clés dans `config.json` ; alias `sync`. On raffinera à l'usage.
- **Tests :** suite Node native (`node --test`, zéro dépendance) — `test/ownership`, `test/manifest`, `test/init-manifest`, `test/update`, `test/cli-update`. `npm test` = `node --test`.

---

## Session 6 — v0.6

### D17 — Auto-détection d'agent + multi-agent : `adapters.js` devient un registre déclaratif
- **ACTÉ.** `init` **détecte les agents installés** et choisit des défauts sensés au lieu d'imposer `claude,codex`. Objectif : l'utilisateur ne devrait pas avoir à déclarer son agent.
- **Registre déclaratif (`lib/adapters.js`) :** fin du `if (claude)…if (codex)…` en dur. Un descripteur par agent — `{ id, entries:[{path,content}], runner, detect:{bin,dirs} }`. `entries` = les shims d'entrée natifs pointant vers `.spectoflow/AGENTS.md` ; `runner` = commande headless par défaut (alimente `config.runners`, ajustable — cf. D15) ; `detect` = binaire PATH + dossiers indices. **L'ordre du registre = priorité de l'agent par défaut.**
- **Agents v1 :** `claude` (`CLAUDE.md` + `.claude/commands/spectoflow.md`), `codex` et `cursor` (partagent `AGENTS.md`, dédupliqué par `writeIfAbsent`), `gemini` (`GEMINI.md`). `opencode`/`kilocode` = point d'extension prêt, ajoutés quand leurs conventions sont confirmées.
- **Détection (`lib/detect.js`) :** signal principal = binaire résolvable dans le PATH (⇒ le runner marchera), **PATHEXT-aware** sur win32 ; signal secondaire = dossier agent existant (`.claude/`, `.codex/`…). Retourne la liste ordonnée par priorité. Prouvé sur PATH réel (détecte claude+codex dans cet environnement).
- **Câblage `init` :** `--agent=` explicite gagne (aucune surprise) ; sinon détection → shims de **tous** les détectés, `config.agent` = le premier par priorité, `config.runners` complété (merge non destructif) ; **rien détecté → fallback `claude` + `codex`** (comportement historique). Message d'install indique ce qui a été détecté.
- **Dashboard :** aucun changement — il défaulte déjà sur `config.agent`/`config.runners`. Le bon défaut vient de l'init.
- **Tests :** `test/detect`, `test/adapters`, `test/init-detect` (détection injectée via env PATH contrôlé + `process.execPath`).

---

## Session 7 — v0.7

### D18 — Chat widget flottant : le run devient une conversation, entrée du group-chat
- **ACTÉ.** L'onglet/panneau **Run** (vide, encombrant) est **supprimé**. À la place : un **lanceur flottant 💬 en bas-droite** qui ouvre une fenêtre de chat compacte ancrée bas-droite.
- **Comportement :** enveloppe le flux run **existant** (`POST /api/run` + SSE `run-*`, **serveur inchangé**) présenté en chat — bulle utilisateur (droite, ambre), sortie agent en bloc monospace (gauche), lignes méta ▶ (démarrage) / ■ (fin, verte). Sélecteur d'agent compact (défaut `config.agent`), Cmd/Ctrl+Enter conservé. État ouvert/fermé mémorisé en `localStorage` (`spf-chat`).
- **Détail d'implémentation appris :** le streaming doit s'accumuler dans **un seul nœud texte** (`pre.textContent += chunk`), pas un `<span>` par chunk — sinon les chunks se disposaient en colonnes côte à côte dans le `<pre>`. Marqueurs ▶/■ sortis en lignes `.chat-meta` séparées.
- **Périmètre :** front only (`dashboard/public/{index.html,styles.css,app.js}`). Le vrai **message log multi-agents par identité** (`runtime.messages`, rôles) reste l'item suivant (group-chat) — le widget en est le **contenant/point d'entrée**, sans préempter ce modèle de données (YAGNI).
- **Vérification :** pas de test unitaire DOM (cohérent avec le reste du dashboard, non testé ; jsdom casserait le zéro-dép) — **vérifié en réel** dans Chrome contre un projet de préview à runner stub (ouverture/fermeture, envoi, stream, persistance, correction du bug de colonnes).
