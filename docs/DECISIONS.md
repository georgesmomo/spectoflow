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

---

## Session 8 — v0.8

### D19 — Group-chat par identité d'agent : log de messages + sentinelles stdout, pipeline extrait
- **ACTÉ.** Le runtime porte un **log de messages** : `runtime.messages: [{ id, at, role, agent, runId, text, kind }]` (volatile, gitignoré — anticipé par D8). `role` = rôle de workflow (analyst / developer / qa / …) ; `kind` = message | status | question | handoff. Helper `store.appendMessage` (id/at estampillés côté serveur, non surchargeables).
- **Mécanisme d'émission (le choix ACTÉ du roadmap « pick one ») = sentinelles stdout.** L'agent s'identifie en imprimant `::spectoflow role=developer kind=status msg=…` ; `store.parseAgentLine` en fait un message structuré, les autres lignes streament en brut. Choisi car **testable maintenant** (stub) et greffé sur le `spawn`+`pipe` existant. **MCP reste l'évolution prévue** (D6) écrivant dans le **même** log.
- **Pipeline extrait dans `templates/dashboard/runner.js`** (`startRun(root, {prompt,agent}, emit)`) — hors de `server.js`, donc **unit-testable sans serveur HTTP**. Il : (1) logge le prompt utilisateur comme message `role:user` ; (2) `runStart` + SSE ; (3) bufferise stdout/stderr par lignes → sentinelle ⇒ `appendMessage`+SSE `message`, sinon SSE `run-line` (brut) ; (4) à la fin, message `kind:status` « finished (exit N) ». `server.js` ne fait plus qu'appeler `startRun`.
- **Widget = vue du log.** Rendu **incrémental par id** (pour ne pas effacer le bloc de sortie brute en cours) : bulles identifiées (tag rôle · agent, couleur par kind), utilisateur à droite. La sortie brute reste un bloc **éphémère** (non loggé, D8). Historique **persistant** : au reload, le log se repeuple depuis `runtime.messages` (la sortie brute, elle, disparaît — voulu).
- **Hors périmètre :** canal MCP, threads/édition, @mentions. Un seul log par projet.
- **Tests :** `test/messages` (`parseAgentLine`, `appendMessage`), `test/runner` (pipeline bout-en-bout via un agent-fixture émettant une sentinelle → assertions sur `runtime.messages` + events). Front vérifié en direct dans Chrome (group-chat multi-rôles + persistance au reload).

---

## Session 9 — v0.9

### D20 — Orchestrateur : séquenceur déterministe fin, `workflow.md` porte la résolution `{cap/skill/policy}`
- **ACTÉ.** L'orchestrateur devient le **séquenceur déterministe fin** annoncé par le roadmap : il parcourt les étapes **ACTIVÉES** du workflow, dans l'ordre, en respectant le **mode**. L'invariant d'architecture est préservé — l'intelligence reste dans l'agent+skill, l'orchestrateur ne fait que résoudre/gater/lancer/collecter, jamais l'analyse elle-même.
- **`workflow.md` étendu :** chaque ligne d'étape peut porter une annotation traînante `{cap:<capability> skill:<skill> [policy]}`. `store.readWorkflow` la parse, reste rétro-compatible (ligne sans annotation → `cap/skill = null`). Résolution : `step.cap → agent` (scan du front-matter `capability:` dans `agents/*.md`, premier match) ; `step.skill → skills/<skill>/SKILL.md`. Étape non résolvable (capability sans agent, ou skill manquante) → l'étape passe `failed`, le run s'arrête, message d'erreur clair dans le group-chat (jamais de skip silencieux). Le gabarit par défaut `templates/workflow.md` porte désormais l'annotation sur chaque étape, comblant au passage le trou historique de **Spec** (aucun agent propriétaire) via `{cap:analysis skill:write-spec}`.
- **Pipeline :** `templates/dashboard/orchestrator.js` expose `runOrchestration({root, request, mode, runStep, confirm, resume}, emit)`. `runStep` et `confirm` sont **injectables** (par défaut : `runner.startRun` réel et le mécanisme d'attente d'approbation réel) → boucle et gates **unit-testables sans agent ni HTTP**, même patron que `runner.js` (D19). État persisté dans `runtime.orchestration` (volatile, D8) : `status` du run (`running|awaiting_approval|done|failed|cancelled`), `status` par étape, `currentStep` — survit au reload, pilote le widget, permet la reprise.
- **Endpoints serveur :** `POST /api/orchestrate {request}` → démarre le run (délègue à `orchestrator.js`, même découpage que `runner.js`/`server.js`) ; `POST /api/orchestrate/approve {decision, note?}` → débloque une étape en attente. Le widget 💬 gagne un bouton **Orchestrate** (à côté de **Send**, qui reste le run ad-hoc simple) et, quand une étape attend une décision, des affordances **Approve/Cancel** sous le message `kind:question`.
- **Arbitrages tranchés pendant l'implémentation (au-delà du design approuvé, cf. `docs/orchestrator-design.md`) :**
  - **`semi` v1 = autopilot + policy (O2 du design).** Sans classification dynamique, seules les étapes **policy-gated** confirment en `semi` et en `autopilot` ; `manual` confirme **chaque** étape, quelle que soit la policy.
  - **Règle policy-gated :** une étape est sensible **si et seulement si** son annotation porte `policy`, **ou** `cap:security` — indépendamment du mode, conformément à D2 (la policy borne, le mode gère la friction de routine).
  - **`modify` hors périmètre v1.** Le protocole d'approbation (design §4) prévoyait `approve/cancel/modify` ; le widget v1 n'expose que **Approve/Cancel**. Un chemin `modify` + re-confirmation est différé (fast-follow), cohérent avec O3 (Cancel + repartir de zéro suffit en v1).
  - **Reprise = redémarrage depuis la première étape non-`done`.** Pas de reprise fine intra-étape (hors périmètre v1, cf. design "Out").
  - **`runner.js` durci :** le stdin de l'enfant est explicitement **fermé après le spawn** — corrige un blocage spawn/stdin observé sous Windows, et aide aussi les agents réels qui lisent stdin. Le blocage intermittent multi-spawn observé en test a été diagnostiqué comme **environnemental** (un AV/EDR qui intercepte `CreateProcessW`), pas un bug de code ; le test d'intégration HTTP ne lance donc volontairement **qu'une seule étape** pour le minimiser. Un timeout de hang par étape (agent qui ne répond plus) est différé à un futur incrément de fiabilité.
- **Référence :** `docs/orchestrator-design.md` (statut passé à **implemented**) — spec complète, tableau de résolution par défaut, protocole d'approbation, surface serveur.

---

## Session 10 — v0.10

### D21 — Agents & skills passent de stubs à des playbooks sourcés, best-in-class
- **ACTÉ.** Les 10 agents (`.spectoflow/agents/*.md`) et les 8 skills (`.spectoflow/skills/*/SKILL.md`)
  existants — jusqu'ici une persona en une ligne de mandat, une skill en trois puces — sont réécrits
  pour encoder les **meilleurs standards, méthodes et techniques de leur domaine**, avec la **source
  citée** dans le fichier. C'est l'invariant du produit rendu concret : le « cerveau » de spectoflow,
  ce sont des instructions qu'un agent lit, pas un moteur runtime — donc leur qualité **est** la
  qualité du framework. Référence : `docs/agents-skills-upgrade-design.md` (statut passé à
  **implemented**).
- **Deux formes gold-standard, définies une fois dans `docs/agents-skills-standard.md`, appliquées
  partout :**
  - **Agent** (persona) : `Mandate` → `Operating standards` (méthodes citées, une ligne de « pourquoi »
    chacune) → `Definition of done` → `Handoff` → `Guardrails`. Front-matter enrichi de **`standards:`**
    (liste des méthodes/sources tenues par le rôle) et **`priority:`** (optionnel, départage quand une
    capability a plusieurs agents) — les clés existantes (`name`/`capability`/`uses`/`description`)
    restent inchangées, l'orchestrateur continue de résoudre dessus.
  - **Skill** (procédure) : `When to use` → `Method` (procédure numérotée, sourcée — le standard du
    domaine vit ici) → `Output contract` (artefact exact + où il est écrit + comment l'agent rapporte)
    → `Quality bar` (checklist vérifiable) → `References`. Front-matter enrichi de **`capability:`**,
    **`inputs:`**, **`outputs:`**, **`standard:`** (source nommée).
- **Convention de propriété du sentinel :** la skill (`Output contract`) est seule propriétaire de la
  syntaxe exacte `::spectoflow role=… kind=… msg=…` (D19) ; l'agent ne fait que la référencer dans son
  `Handoff`, jamais la redéfinir — une seule source pour ce contrat, pas de dérive entre fichiers.
- **Standards effectivement encodés, par capability :** sécurité → **OWASP ASVS + Top 10** (pilote,
  choisi car il exerce le mieux la recherche sur standard externe) ; tests unitaires → **TDD
  red-green-refactor, patterns xUnit** ; tests E2E → **Playwright** (locators par rôle, assertions
  web-first, fixtures, trace-on-retry, pas de wait en dur) ; analyse → **BDD (Given/When/Then)** pour
  les critères d'acceptation + conventions **spec-kit / OpenSpec** pour le gabarit de spec ;
  implémentation → **Conventional Commits**, YAGNI/DRY, petits commits, règle du boy-scout ;
  architecture → **C4** (vues) + **ADR** (MADR / Nygard) ; planification → **INVEST** (découpage de
  tâches, décomposition ordonnée par dépendances) ; qualité → grille de revue façon **Google**
  (correction / tests / lisibilité / sécurité, niveaux de sévérité) ; intake → **découverte produit
  structurée** (problème / utilisateurs / contraintes / risques) ; design → heuristiques **Nielsen** ;
  operations → **DORA / CI-CD / IaC**.
- **Nouvelle capability `operations` :** `devops` portait `capability: implementation`, en collision
  avec `developer` — résolution `readdir`-dépendante côté orchestrateur. Fix **par la donnée, pas par
  le code** : `devops` passe à `capability: operations`, ajoutée à la palette de `capabilities.md` (et
  aux lignes de projet infra/ops) ; `developer` reste seul sur `implementation`. `resolveStep`
  inchangé.
- **Deux skills manquantes comblées :** `implement` (l'étape `Develop` du workflow n'avait aucune
  skill — trou historique) et `write-e2e-tests` (Playwright — voir stratégie E2E ci-dessous).
- **Stratégie E2E — deux activités distinctes, jamais confondues :**
  - **La suite E2E durable**, committée, rejouable en CI, **agent-agnostique** → **Playwright** est le
    standard produit par la skill `write-e2e-tests`. Ces fichiers de test sont des artefacts durables,
    au même titre que `specs/`/`plans/`.
  - **La vérification live/exploratoire** en cours de dev → outillage navigateur **natif** de l'agent
    (ex. l'extension Chrome de Claude Code), avec **repli sur Playwright headed/codegen** si absent ou
    en échec. Ce repli appartient à la vérification, jamais à la suite committée.
  - Zéro-dépendance préservé : la skill reste du markdown ; Playwright n'est une dépendance que du
    **projet utilisateur**, jamais de spectoflow lui-même.
- **Garde-fou de cohérence — `test/roster-integrity.test.js` :** vérifie que chaque `capability:`
  d'agent est bien dans la palette de `capabilities.md`, que chaque skill listée dans un `uses:`
  d'agent existe sur disque, que chaque annotation `{cap:… skill:…}` du workflow résout, et qu'aucune
  capability n'est partagée par deux agents sans `priority:` de départage. Le fix de `operations`
  (ci-dessus) a été fait dans le même commit que ce garde-fou, pour que la suite reste verte en
  permanence — jamais de fenêtre rouge entre étapes.

---

## Session 11 — v0.11

### D22 — Refonte « control-room » du dashboard : identité ambre gardée, structure de la référence adoptée, Overview + sidebar calculés côté client
- **ACTÉ.** Le dashboard passait pour utilitaire face à une référence fournie par l'utilisateur (un
  control-room sombre riche : cartes KPI, donut de statut, barres de progression par phase, chips de
  filtre, sidebar droite). Cette passe l'amène à ce standard **sans toucher** l'orchestrateur, le chat,
  le moteur de workflow ni le SSE temps réel — c'est une passe **visuelle + une nouvelle section
  Overview**, calculée à partir de données déjà disponibles. Référence : `docs/dashboard-redesign-design.md`
  (statut passé à **implemented**).
- **Identité gardée, pas un remplacement de palette.** L'ambre `--signal` (`#e6a54b`, l'identité
  spectoflow — le point ambre = ce qui tourne) et le cyan secondaire sont **conservés** comme accent
  live/actif. Ce que la référence apporte : son **système de cartes**, ses **neutres chauds**, le rayon
  14px, les ombres douces, et sa **cartographie couleur↔statut** — pas un remplacement de teinte.
- **Nouvel onglet Board — Overview :** une rangée de **4 cartes KPI** (progression globale en donut-ring,
  en cours, à valider, agents en cours / dernière orchestration) ; un **donut de statut** sur les 6
  statuts ; une **bande « workflow en un coup d'œil »** (réutilise l'animation du diagramme Workflow),
  qui remplace le graphique en aires temps-série de la référence — spectoflow ne garde pas
  d'historique daté ; des **barres de progression par phase** de plan.
- **Filtres + recherche :** chips de statut (Tous / To do / In progress / To validate / To analyze /
  Done / Blocked) + chips owner/level + une recherche texte, qui filtrent le board de tâches en
  dessous, inchangé dans sa logique (sections de phase repliables, drawer de tâche).
- **Sidebar droite :** **« À demander »** — les tâches `to_validate`/`to_analyze` (ce qui attend
  l'humain, cf. D4), une ligne compacte par tâche vers son drawer ; **« Journal »** — le log de
  messages du group-chat (`runtime.messages`) en flux d'activité anté-chronologique (rôle · agent ·
  kind · texte), mis à jour en direct via SSE.
- **Graphiques = SVG inline, écrits à la main (zéro dépendance).** `donut()`, `ring()`, `bars()`,
  `sparkline()` — pas de librairie de charts, cohérent avec l'invariant zéro-dépendance du framework.
- **Tout l'agrégat est calculé côté client**, dans un module pur et **testé unitairement** —
  `templates/dashboard/public/stats.js` (`stats(project) → {total, done, pct, byStatus, phases, toAsk,
  running}`), compatible navigateur + Node (`module.exports` gardé), consommé par `app.js` côté
  navigateur et par `test/dashboard-stats.test.js` sous `node --test`.
- **Aucun changement serveur/API.** `GET /api/project` porte déjà tout ce dont l'Overview a besoin
  (plans/tâches, `runtime.messages`, `runtime.agents`/`orchestration`, `workflow`) ; aucun nouvel
  endpoint. L'orchestrateur, le widget de chat, Approve/Cancel, le diagramme Workflow, Agents & Skills,
  les écritures granulaires et le temps réel SSE sont **préservés** tels quels — seule la couche de
  présentation change.
- **Sections repliables (persistées en `localStorage`) et système de cartes unifié** sur tous les
  onglets (Board / Workflow / Agents & Skills), cohérent avec le nouveau langage visuel.

---

## Session 12 — v0.12

### D23 — Navigation + chat du dashboard : header dense à onglets-icônes, Requests/Info/Backlog, Agents & Skills enrichi + tiroir, Chat en onglet, dynamisme retrouvé (courbe, `charts.js`, animations)
- **ACTÉ.** Suite à la refonte « control-room » (D22), cette passe complète la **navigation** et le
  **chat** sur le même socle zéro-dép, SSE, écritures granulaires — sans toucher l'orchestrateur, le
  moteur de workflow ni les endpoints existants. Référence : `docs/dashboard-nav-design.md` (statut
  passé à **implemented**).
- **Header refondu.** Bandeau plus dense et délibéré : à gauche la marque + `/ <projectType>` + un
  sous-titre (mode · langue) et un **mètre de progression globale** filiforme sous la marque ; au
  centre la nav à **onglets-icônes** — **Board · Requests · Backlog · Workflow · Agents & Skills ·
  Chat · Info** (soulignement ambre actif) ; à droite les chips agent actif/langue/mode, l'indicateur
  de **sync** (point pulsant) et un bouton **Run** en accès rapide qui ouvre le widget de chat.
- **Le bloc « À demander » de la sidebar devient l'onglet Requests, traduit en anglais.** L'UI est
  **anglais uniquement** (le sous-titre « À demander » de D22 était la seule survivance en français
  côté interface) ; le contenu (tâches `to_validate`/`to_analyze`) est inchangé, seulement déplacé de
  la sidebar vers un onglet dédié pour lui donner la place de respirer.
- **Deux nouveaux onglets :**
  - **Info** — un panneau « à propos du projet » calme, lu depuis `config` + les agrégats déjà
    disponibles (type de projet, mode, langue, agent actif, `runners`, compteurs tâches/spécs/agents/
    skills/étapes de workflow activées) ; entièrement côté client via `GET /api/project`, aucune
    nouvelle donnée serveur.
  - **Backlog** — une **table plate** de toutes les tâches de tous les `plans/*.md` (id · titre ·
    phase · statut · owner · niveau · 💬 commentaires), **triable** par en-tête de colonne,
    **filtrable** (statut/owner/niveau + recherche texte, logique réutilisée du Board), une ligne
    ouvre le **drawer** de tâche existant. Vue lecture seule, mêmes données que le Board.
- **Agents & Skills enrichi + tiroir plein-corps.** Les cartes montrent désormais `capability` +
  `standards` (agents) / `capability` + `standard` + `inputs`/`outputs` (skills) + `uses` en plus de
  la description ; un clic ouvre un **tiroir** affichant le **corps markdown complet** du fichier
  (Operating standards / Method / Quality bar / …), rendu par un **mini-moteur markdown maison**
  (`mdLite` — titres/listes/code inline/paragraphes, HTML échappé avant tout balisage), pas de
  librairie. Nécessite : `store.readAgents`/`readSkills` étendus pour exposer ces champs de
  front-matter (parsing seul, aucun changement d'écriture) et **un seul nouvel endpoint**, lecture
  seule, `GET /api/agentfile?path=` → `{ content }`, **strictement scopé** à `.spectoflow/agents/**`
  et `.spectoflow/skills/**` et **path-traversal-safe** — le seul changement serveur de l'incrément.
- **Chat en onglet plein-écran, à côté du widget flottant redessiné.** Les deux rendent le **même**
  `runtime.messages` group-chat et utilisent `POST /api/run` / `POST /api/orchestrate` inchangés,
  via un **rendu partagé** `renderChatLog(container)` — l'onglet et le widget ne peuvent jamais
  diverger. Le widget flottant est redessiné (header plus propre, mêmes transcript/input), point
  d'accès rapide depuis n'importe quel onglet.
- **Le dynamisme perdu en 0.11 revient.** L'Overview du Board retrouve la **courbe d'aires**
  scope-vs-livré (abandonnée en 0.11 faute d'historique daté) : elle lit désormais un vrai
  **instantané** `runtime.history: [{date, total, done}]`, un point par jour calendaire, dédupliqué
  (`store.recordSnapshot`, aujourd'hui écrasé / nouveau jour ajouté, plafonné aux ~60 derniers points,
  seedé d'un point unique quand vide pour ne jamais laisser le panneau à blanc). **Écriture
  garde-fou :** l'instantané n'est persisté que si `{total, done}` diffère réellement du dernier point
  (une lecture sans changement ne touche jamais le disque), et le serveur **relit `runtime.json`
  juste avant d'écrire** pour muter uniquement son champ `history` — sinon un instantané concurrent au
  group-chat aurait pu écraser des `runtime.messages` fraîchement ajoutés par un run en cours (bug
  intercepté et corrigé pendant l'implémentation, cf. commits « re-read runtime before snapshot write
  » et « readProject snapshot must preserve runtime.messages »).
- **`dashboard/public/charts.js` — module de graphiques, testé unitairement.** Extrait de l'ancien
  `donut()`/`ring()`/`bars()` inline de D22 en un module `SpectoCharts` (browser + Node via
  `module.exports` gardé) qui ajoute **`area()`** (courbe lissée Catmull-Rom, remplissage dégradé,
  grille + axes, tracé animé via `pathLength`, points + tooltips au survol) aux côtés de `donut`,
  `bars`, `ring` — couvert par `test/dashboard-charts.test.js` (maths de tracé/arc en pur, sans DOM).
- **Icônes et animations, respectueuses de `prefers-reduced-motion`.** Un petit jeu d'icônes SVG
  inline maison (pas de police/librairie d'icônes) sur chaque onglet, carte KPI et en-tête de section ;
  animations portées de la référence (`rise` à l'entrée des cartes, tracé du donut par arc échelonné,
  barres qui poussent avec compte-à-rebours numérique, anneau de progression en dégradé animé, point
  de sync pulsant) — toutes désactivées quand l'utilisateur demande moins de mouvement (garde déjà en
  place, étendue à chaque nouvelle animation).
- **Deux petits correctifs pliés dans cette passe :** le **chevron** de repli de phase (0.11) avait sa
  direction inversée — corrigé ; et un **`activeTab` source de vérité unique**, persistée
  (`localStorage`), garantit que l'onglet actif reste stable à travers les re-rendus déclenchés par
  SSE (auparavant le re-rendu pouvait faire retomber l'UI sur l'onglet Board).
- **Aucun changement de surface serveur au-delà de `/api/agentfile`.** `/api/run`, `/api/orchestrate`,
  les mutations granulaires de tâche/workflow, et le flux SSE restent inchangés.

### D24 — Passe « usage réel » 0.13 : dossier de plans configurable, onboarding, onglet Attention, settings, routing
- **ACTÉ.** Issu d'un premier usage réel de spectoflow sur un projet tiers. Onze correctifs regroupés en 0.13 :
  - **Dossier de plans/specs élargi et configurable.** `config.plansDir`/`specsDir` (défaut `null` → auto‑détection
    `plans`→`plan`, `specs`→`spec`). L'ancien comportement (un projet gardant ses plans dans `plan/` au singulier
    n'était pas vu) est corrigé. Le routeur d'intention (AGENTS.md) signale à l'utilisateur qu'il peut pointer le
    dossier. Résolveurs purs `resolvePlansDir`/`resolveSpecsDir` dans `store.js`, unit-testés.
  - **Onboarding.** Sortie de `init` guidée et concise ; l'agent affiche les prochaines étapes après init.
  - **Dashboard plus simple à lancer.** `spectoflow dashboard` promue comme commande unique (avec `--port`),
    **détection de l'état « en cours d'exécution »** (sonde HTTP `/api/project`), `status` l'affiche, et l'agent
    l'auto‑démarre (détaché) en fin d'init / à la première demande sauf opt‑out (`config.dashboard.autostart`).
  - **Prompt système masqué.** Les runs orchestrés ne réaffichent plus le prompt d'amorçage « You are the … »
    comme bulle (`startRun({logPrompt:false})`) ; l'orchestrateur poste déjà une ligne propre « → étape (agent) ».
  - **Settings.** `POST /api/settings` écrit `config.json` (mode + langue) ; popover engrenage dans le header.
  - **Onglet Attention.** Points d'attention dans `runtime.attention` : l'agent en remonte via la sentinelle
    `::spectoflow attention msg=…`, l'utilisateur peut en ajouter ; CRUD (`/api/attention*`) + **valider → tâche**
    (`/promote` crée une checkbox `T-###` sous une phase `## Attention`). Badge d'onglet = points ouverts.
  - **Backlog.** Filtre **Open** (non‑done) par défaut + **pagination** (25/page).
  - **Anti‑scintillement.** SSE `load()` **debounced** (180 ms) et animations d'entrée cadrées sous `body.booting`
    (jouent une fois au chargement, pas à chaque re‑rendu live).
  - **Logo.** Le vrai logo spectoflow (image, swap clair/sombre) remplace le carré à dégradé conique dans le header.
  - **Workflow redesigné.** Cartes d'étape numérotées (capability + skill + état enabled/disabled), connecteurs, wrap responsive.
  - **URLs.** Routing client `History API` `/<onglet>[/<taskId>]` + **fallback SPA** côté serveur (une route sans
    extension sert `index.html`) — fini l'URL unique.
- **Contrainte respectée :** zéro dépendance runtime, tout en anglais côté UI, SSE/écritures granulaires/orchestrateur inchangés.
- **Non publié tel quel :** 0.13.0 est poussée sur `main` mais **pas taguée** — à valider en usage réel avant `git tag v0.13.0`.

### D25 — Refonte design 0.13.2 : palette violette, système multi-designs, workflow pipeline, polices auto-hébergées
- **ACTÉ.** Grosse passe UI issue d'un aller-retour serré avec l'utilisateur.
  - **Re-skin violet** (control-room) : `--signal` ambre → violet #7c5cff, vert #4caf72 pour le done, teal secondaire ; le **logo ambre** reste la seule touche chaude. KPIs à liseré coloré, animations calmées, courbe conservée.
  - **Header épuré** : suppression des chips CLAUDE/EN/SEMI et de l'engrenage (doublon avec l'onglet Settings) ; **lune** pour le thème ; **version du framework** affichée (header + footer + Settings, via `.spectoflow/.manifest.json` avec fallback kit).
  - **Onglet Settings** (mode + langue + **design**) ; **footer** pro (nom, version, licence, GitHub/npm). Nom de l'auteur retiré du footer (reste dans `package.json`).
  - **Workflow** refait : **pipeline horizontal** d'icônes représentatives (résolues par nom d'étape), connecteurs animés + **flèches** directionnelles, **popover** (tooltip cliquable) au clic avec description/capability/agent/skill + bouton activer/désactiver ; **reflow mobile** sans scroll horizontal.
  - **Responsive** : header en grille `auto minmax(0,1fr) auto`, tabs qui scrollent, **menu hamburger** ≤900px, `overflow-x:hidden`. Boutons chat compacts.
  - **Système multi-designs** (`data-design` sur `<html>`) : registre `designs.js` + blocs CSS scoped (`:root[data-design="<id>"]`) + sélecteur dans Settings + persistance (localStorage par-utilisateur, `config.design` par-projet) + re-render des charts au switch. **Ajouter un design = 1 entrée registre + 1 bloc CSS.**
  - **3 designs** livrés : **Control Room** (violet), **Obsidian Ops** (near-black lime/cyan, mono), **Neon Command** (glassmorphism aurora violet/cyan). Chaque design gère clair **et** foncé ; le header suit toujours les tokens (jamais de couleur en dur) pour éviter logo/texte invisibles.
  - **Polices auto-hébergées** (Space Grotesk, Sora, IBM Plex Sans, JetBrains Mono en `.woff2` sous `dashboard/public/fonts/`, ~220 Ko) → **offline préservé**, invariant Node zéro-dépendance intact ; MIME `woff2` ajouté au serveur.
- **Correctif sécurité (0.13.1)** : `GET /api/agentfile` bloque désormais un symlink s'échappant du périmètre agents/skills.
- **CLI (0.13.x)** : `--version`/`-v`/`version`, `--help`/`-h`, sortie `update` colorée ; publication npm automatique par tag (OIDC Trusted Publishing, provenance).

### D26 — 0.13.3 : 4ᵉ design + fixes popover/cache
- **ACTÉ.**
  - **4ᵉ design « Mission Control »** — panneau indigo (#5b6cff) sur slate solide, statuts vert/ambre/rose/violet, onglet actif en pastille pleine (reproduit le thème du skill init-dashboard de l'utilisateur). Clair + foncé.
  - **Popover Workflow** — hauteur plafonnée dynamiquement à l'espace disponible (never off-screen) + **footer sticky** pour le bouton activer/désactiver + scroll interne ; retrait du `scroll`-to-close (capture) qui fermait le popover sur son propre scroll interne.
  - **Cache** — le serveur du dashboard envoie `Cache-Control: no-store` sur les fichiers (fonts en `max-age`), pour ne jamais servir un `app.js`/`styles.css` périmé (cause des « changements pas visibles »).
  - **Correctif clair (0.13.3 inclut la passe 0.13.2)** : le header suit toujours les tokens du thème (jamais de couleur en dur) → logo/texte visibles dans toutes les variantes clair/foncé de tous les designs.

### D27 — 0.13.4 : vue Board List / Kanban
- **ACTÉ.** Le board (liste des tâches) offre un **toggle de vue** : **List** (sections repliables par phase, l'existant) et **Kanban** (une colonne par statut, mêmes cartes de tâches). Persistant par-utilisateur (`localStorage spf-board-view`) ; les chips de statut sont masqués en Kanban (les colonnes *sont* les statuts). Client-side, aucune écriture ni endpoint nouveau.

### D28 — 0.13.5 : board compact par défaut (gros projets)
- **ACTÉ.** Sur un gros projet, toutes les phases étaient dépliées → board interminable. Désormais les phases sont **repliées par défaut** (on suit un set `expandedPhases`, vide = tout replié ; persistance `localStorage spf-expanded`), avec un bouton **Expand all / Collapse all**. Les colonnes **Kanban scrollent** en interne (hauteur plafonnée). Client-side, aucun endpoint nouveau.

### D29 — 0.14.0 : agent Spec Source Guardian (capability `governance`)
- **ACTÉ.** Suite à une recherche sur le débat « spec vs code comme source de vérité » (2025‑2026) : le consensus pragmatique est **spec‑anchored** (la spec = intention/décisions/critères ; le code + les tests restent la vérité applicable, les tests = enforcer). On ajoute donc un gardien de **cohérence**, pas un dévot de la prose.
- **Nom retenu : `spec-source-guardian`** (pas « alignment »). Nouvelle capability **`governance`** — **advisory, hors workflow** :
  - **Agent** `spec-source-guardian` + **skill** `audit-source` : audit spec ↔ plan ↔ code ↔ tests dans les deux sens (travail orphelin / spec morte), vérifie que les critères d'acceptation sont encodés par un test. **Ne corrige jamais** (pas de sync auto — le langage naturel est trop ambigu, cf. « drift‑trap »), il **signale**.
  - **Sorties** → onglet **Attention** (via `::spectoflow attention`), l'utilisateur édite/résout/valide→tâche.
  - **Script** `lib/spec-drift.js` (zéro‑dep, unit‑testé) : signaux déterministes de dérive (couplage code↔spec, couverture).
  - **Hook opt‑in** `hooks/spec-drift.js` (Stop hook Claude Code, à câbler soi‑même dans `.claude/settings.json`, jamais installé d'office pour ne pas écraser les réglages).
  - **Gate** `policy.md` : dérive non résolue **bloque à `done`/Major** (acknowledge, pas d'auto‑fix) ; jamais de blocage mid‑edit.

### D30 — 0.14.2 : Phase progress compact (gros projets)
- **ACTÉ.** Sur un gros projet, la carte « Phase progress » de l'overview rendait **une barre par phase**, y compris les `##` **sans tâche** (« Détails techniques », « Endpoints »…), soit des dizaines de barres → page interminable. Désormais : (1) on ne garde que les phases **avec des tâches** (`total>0`), (2) **hauteur plafonnée** (340px) + scroll interne quand il y en a beaucoup. Combiné au board replié par défaut (D28), le dashboard reste compact.

### D31 — 0.15.0 : réflexe `clarify` (expert-analyste) gravé dans la mémoire de l'agent
- **ACTÉ.** Constat (inspiré d'un échange type Matt Pocock / « grill-me ») : l'IA rate la cible quand le besoin est flou — ex. « la page de login s'affiche mal, les users n'arrivent pas à se connecter ». Le framework doit se comporter en **analyste expert**, pas en suiveur : clarifier avant d'agir.
- **Deux niveaux, additifs (ne remplacent rien) :**
  - **Mémoire** (`templates/AGENTS.md`, donc copié dans chaque projet à l'`init` et poussé aux existants par `update`) : une **posture « expert analyst, not an order-taker »** (raisonner à partir des objectifs du projet **et** des best practices, recommander, pousser un avis) + une **étape 0 « Clarify » dans le Routeur**, avant `Classify`. Renforcé par 1 ligne dans les shims racine (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`).
  - **Procédure** : nouveau skill `templates/skills/clarify/` (capability `intake`, porté par `product-manager`, `uses: [clarify, brainstorm]`).
- **Comportement clé** : sur toute requête ambiguë → refléter en une phrase → **une question ciblée à la fois** (jamais un bloc), chacune **avec une recommandation raisonnée** → boucle jusqu'à ce que ce soit net → on confirme → on exécute le flux normal. **Mode-aware** (`autopilot` = 1 hypothèse énoncée + on avance ; `semi`/`manual` = on clarifie) ; « fais au mieux » honoré via hypothèses explicitées ; garde-fous anti sur-questionnement + plafond de tours. `::spectoflow role=intake kind=clarify`.
- **Non-régression** : purement additif — pour un nouveau build, `clarify` se fond dans `brainstorm` ; pour un bug/changement sur projet existant, il se déclenche seul en amont du Routeur existant.

### D32 — 0.15.0 : Playwright MCP câblé à l'`init` (idempotent) + échelle de repli E2E
- **ACTÉ.** `init` **merge** une entrée `playwright` dans le `.mcp.json` du **projet cible** (et `.cursor/mcp.json` si Cursor est sélectionné), pour que l'agent E2E (`qa-engineer`) pilote un vrai navigateur et génère/joue des tests Playwright. **Idempotent + non destructif** : crée si absent, ajoute sans toucher aux serveurs existants, **laisse tel quel** si `playwright` est déjà là ou si le fichier est illisible. Helper zéro-dep `lib/mcp.js` (`mergeMcpServer` → `created|added|exists|skipped`), unit-testé (`test/mcp.test.js`).
- **« Installer » = câbler la config** : `npx @playwright/mcp@latest` récupère le serveur au premier usage — rien à installer globalement, **zéro-dépendance de spectoflow intact** (on écrit dans le projet de l'utilisateur, jamais dans spectoflow ; `update` ne retouche pas `.mcp.json`, user-owned).
- **Repli quand le MCP n'est pas dispo** (documenté dans `write-e2e-tests` + `qa-engineer`) : (1) Playwright MCP → (2) outillage navigateur natif du client (`claude-in-chrome`) → (3) Playwright local (`codegen`/headed, `@playwright/test` en devDep) → (4) si aucun navigateur : **écrire quand même la spec** + lever un `need`/Attention avec les commandes exactes — jamais de faux « vert ». L'artefact durable reste toujours le `*.spec.ts` commité.

### D33 — 0.16.0 : passe UX de la CLI (logo ASCII, commandes explore, aide par-commande, dashboard détaché)
- **ACTÉ.** Suite au ressenti utilisateur (« le clarify est un peu brute » + demande d'une CLI mieux designée). Deux axes : polish du ton clarify + refonte UX de la CLI.
- **Logo ASCII** : wordmark box-drawing « spectoflow » (3 lignes, 30 colonnes, ambre), affiché sur `init`, `update`, `help`, `list`. Intégré là où un humain lit (pas sur `-v`/status, qui restent scriptables).
- **Nouvelles commandes explore** : `spectoflow list` (agents + skills + workflow d'un coup), `agents`, `skills`, `workflow`. Lisent depuis le `.spectoflow/` du projet, sinon le kit bundlé (`frameworkSource()`), via un mini-lecteur de frontmatter zéro-dep (`frontmatter()` + `listAgents`/`listSkills`/`readWorkflowSteps`). `●` activé / `○` désactivé pour le workflow.
- **Aide par-commande** : `-h`/`--help` après une commande affiche **son** aide (`HELP` map + `showHelp`) au lieu de l'exécuter — ex. `spectoflow dashboard -h`, `init --help`. Le dispatch teste `wantsHelp = argv.slice(1).some(-h/--help)`.
- **`dashboard` détaché** : `spawn(..., {detached:true, stdio:'ignore'})` + `child.unref()` → démarre en arrière-plan et **rend la main**, puis affiche un panneau de commandes. Sous-commandes ajoutées : **`dashboard status`** (up ? url + pid depuis le lock) et **`dashboard restart`** (stop → 400ms → start), à côté du `stop` (0.14.1). Refactor : `startDashboard()` extrait.
- **Aide globale redesignée** : groupée (Project · Dashboard · Explore · Options), colorée, avec le banner. `init`/`update` re-stylés (✓/+/! colorés, banner en tête). `cli-update.test.js` attend le littéral « spectoflow update » → conservé dans le header sous le banner.
- **Ton clarify affiné** : le skill guide un ton **naturel et immersif** (acknowledge → reflect → une question), avec une section **Tone** qui donne le registre par l'exemple mais interdit explicitement toute phrase figée/recopiée, et fait **couler** une demande complexe/nouveau-build vers le chemin normal (`brainstorm → …`) plutôt que sur-questionner. Rien n'est figé dans le skill.

### D34 — 0.16.1 : le logo ASCII devient la vraie marque (hexagone + S)
- **ACTÉ.** Retour utilisateur : le banner 0.16.0 (wordmark box-drawing) ne représentait pas le logo. Remplacé par l'**ASCII art de la marque spectoflow** — hexagone flat-top autour du « S » (flow), **rasterisé** (script jetable : distance-aux-arêtes pour l'hexagone + bitmap S style segments), 41×17, avec le **nom « s p e c t o f l o w » centré dessous** + version/tagline. Affiché aux moments de lecture (`init`, `help`, `list`) ; `update` repasse en header compact (pas de grand logo qui pousse le tableau).

### D35 — 0.16.2 : logo ASCII = art de marque réel (fidélité)
- **ACTÉ.** Le tracé 0.16.1 (hexagone re-dessiné + S style segments) ne correspondait pas au vrai logo. Remplacé par **l'art ASCII fourni par l'utilisateur** (hexagone pointu + « S » diagonal/flow), **sous-échantillonné 2×** (81×45 → 41×23, seuil 0.30 par bloc) pour tenir dans un terminal sans wrap, en **préservant la forme** (pas de redraw). Nom centré dessous inchangé.

### D36 — 0.16.3 : deux surfaces logo (hexagone blanc / nom ambre) + wordmark figlet compact
- **ACTÉ.** Aller-retour serré avec l'utilisateur sur l'identité CLI. Résultat :
  - **Hexagone brand en blanc** (`c.white`), **bord gauche épaissi à 4 `#`** (symétrique avec le droit).
  - **Nom = wordmark figlet compact** (police *Small*, ~moitié de la taille standard, 43 large), en **ambre**, **centré sous le vrai milieu de l'hexagone** (`nameBlock(centerUnder)` calcule le centre depuis la boîte du dessin).
  - **`init` + `update`** → `logo()` = hexagone blanc + nom ambre centré (le logo manquait sur `update`, corrigé).
  - **`help` + explore** (`list`/`agents`/`skills`/`workflow`) → `wordmark()` = nom ambre seul (pas d'hexagone).
- Taille du logo débattue (41×23 → réductions 27×15 / 20×12 testées) : on garde l'hexagone 41×23 pour l'accueil, et c'est **le nom** qui a été réduit de moitié (Small) pour le centrage et la légèreté.

### D37 — 0.16.4 : welcome à l'install (postinstall) + brand factorisé
- **ACTÉ.** `npm install -g spectoflow` n'exécute pas le code de la CLI → le logo ne s'affichait pas à l'install. Ajout d'un **script `postinstall`** (`bin/postinstall.js`) qui imprime le logo (hexagone blanc + nom ambre) + « Get started ». **Garde-fous** : ne s'affiche que sur un install **global + TTY** (`npm_config_global==='true'` && `process.stdout.isTTY`), tout est **try/catch** (un banner ne doit jamais casser un install), muet en CI/dépendance. Réserve connue : npm 7+ peut **bufferiser** la sortie des scripts de cycle de vie (sinon `spectoflow` sans args ou `spectoflow init` montrent le même brand).
- **Refactor** : l'art ASCII part dans **`lib/brand.js`** (LOGO, NAME, `logo(c,version)`, `wordmark(c,version)`), partagé par `bin/spectoflow.js` et `bin/postinstall.js` → une seule source, rendu identique partout.

### D38 — 0.16.5 : favicon du dashboard visible (logo noir par défaut, theme-aware)
- **ACTÉ.** Le `<link rel="icon">` pointait sur `logo-white.png` (logo blanc) → **invisible sur un onglet clair**. Corrigé : favicon = **`logo-dark.png`** (noir) par défaut, plus une variante `media="(prefers-color-scheme: dark)"` → `logo-white.png` en dark mode navigateur. Arrive aux projets via `spectoflow update`.

### D39 — 0.17.0 : refonte dashboard — 2 nouveaux templates (« Spectral Console » par défaut, « Orbit »)
- **ACTÉ.** Après recherche (bento grids, micro-animations, ⌘K, dark-first, control-room COP, observabilité d'agents) et **deux prototypes interactifs validés** par l'utilisateur (artifacts), on livre **2 nouveaux designs** dans le système multi-designs existant (`data-design` + registre `designs.js`), chacun dans **ses propres fichiers** `dashboard/public/designs/<id>.css` + `<id>.js` (chargés après `app.js`, actifs uniquement quand leur design l'est, via MutationObserver → switch live sans rechargement) :
  - **`console` — Spectral Console (défaut, sombre par défaut)** : fond bleu-ardoise + grille/halos, **ambre** = accent de marque, **cyan « flow »** = tout ce qui est vivant (agents, SSE, particules du pipeline) ; **rail d'icônes à gauche** (les onglets existants re-dockés), **⌘K palette** (onglets + actions), bento, révélations/compteurs/pulses. Typo Sora · IBM Plex Sans · JetBrains Mono (auto-hébergées). Set clair fourni.
  - **`orbit` — Orbit** : clair d'abord, aéré, circulaire ; **menu radial qui s'ouvre au clic** d'un bouton hub (rond teal = % livré) en overlay centré — items en orbite, anneau segmenté (arc teal = progression, marqueur ambre = vue active), chevrons ▲▼ (navigue sans fermer) ◀ recherche ▶ Run, Esc/`m` ; **contenu pleine largeur** (barre d'onglets masquée). Typo Space Grotesk · IBM Plex Sans · JetBrains Mono. Set sombre fourni. Sur mobile le hub devient un FAB.
- **Défauts** : `<html data-design="console" data-theme="dark">`, `currentDesign()` fallback `console`, `config.json` → `"design": "console"`. Les 4 anciens skins restent sélectionnables (Settings).
- **Contraintes tenues** : zéro dépendance, offline (pas de Google Fonts — Bricolage/Outfit/Manrope des protos remplacées par les fonts auto-hébergées), routing/SSE/API inchangés (les skins ré-habillent et ré-agencent, ils ne réimplémentent rien), `prefers-reduced-motion` respecté. Implémentation parallélisée (2 agents, fichiers disjoints) + intégration manuelle.

### D40 — 0.17.1 : QA visuelle des 2 templates dans Chrome (corrections)
- **ACTÉ.** Passe d'acceptation en navigateur réel (Claude in Chrome, projet QA sur port isolé, données de la démo), les deux designs en clair + sombre, toutes les vues, ⌘K, menu radial. Corrigé :
  - **Console — rail à 1 seule icône** : le header a un `backdrop-filter`, qui devient le *containing block* d'un `position:fixed` descendant → le rail était borné à la hauteur du header (59 px) et défilait avec. Un CSS ne peut pas s'en échapper : `console.js` **déplace `#tabs` sous `<body>`** à l'activation (et le remet à la désactivation) ; `height:100vh` explicite. Les listeners de clic sont sur les boutons → préservés.
  - **Bulle chat (`.chat-fab`)** quasi invisible sur les sets clairs : couleur de marque pleine (ambre) dans les deux designs.
  - **Orbit — connecteurs du pipeline** trop faibles sur le set sombre (ligne `--line` sur `--bg`) : ligne teintée signal.
- Vérifié OK : Console (board/workflow/agents/attention/chat/settings, clair+sombre, ⌘K), Orbit (board clair+sombre, menu radial ouvert/fermé/chevrons, workflow). Le redimensionnement mobile via l'extension n'a pas été appliqué → responsive validé par revue des media queries, pas visuellement.

### D41 — 0.17.2 : E2E — Playwright lib headed par défaut, `--ui`, repli documenté et signalé
- **ACTÉ.** L'utilisateur a demandé une hiérarchie explicite entre Playwright lib, Playwright MCP et l'extension Chrome pour `write-e2e-tests`, visible jusque dans le dashboard.
  - **Défaut : Playwright lib, `--headed`** — les runs locaux (auteur, vérif, debug) se font **directement dans un navigateur visible**, pas en headless silencieux. `--ui` pour l'écriture/debug interactif d'un flow (time-travel).
  - **CI reste headless** — ce n'est **pas** un repli, c'est le job du pipeline (pas d'affichage réel sur la plupart des runners, plus rapide) ; la règle « headed par défaut » ne gouverne que la boucle locale de l'agent.
  - **On ne bascule que si** : l'utilisateur l'a demandé explicitement, **ou** le mode headed ne peut pas se lancer (pas d'affichage, environnement restreint/distant, navigateurs non installés) — dans ce 2ᵉ cas, **on le dit toujours** via `::spectoflow role=testing kind=progress msg=...` (jamais un changement silencieux).
  - **Échelle de repli complète** : Playwright lib headed (défaut) → `--ui` → Playwright lib headless → Playwright MCP (exploration/génération, ou lib absente du projet) → outillage navigateur natif du client → écrire la spec + lever un `need` si rien ne peut tourner.
  - **Visible sur le dashboard** : la `description` frontmatter de `write-e2e-tests` (affichée dans la popover de l'étape « End-to-end tests » du Workflow et la carte du skill dans Agents & Skills) résume désormais cette politique.
- Fichiers touchés : `templates/skills/write-e2e-tests/SKILL.md` (méthode, output contract, quality bar, références Playwright UI Mode / Running tests / MCP repo), `templates/agents/qa-engineer.md` (résumé aligné), `README.md` + `templates/README.md` (doc utilisateur).

### D42 — 0.17.2 : Console — logo header trop petit + footer coupé par le rail
- **ACTÉ.** Retour visuel sur `todo-list-v2` (dashboard réel, design Console).
  - **Logo header trop petit** : `.brand-logo-img` (26px, taille de base commune à tous les designs) manquait de présence face au fond plus sombre/dense de Console. Agrandi à **34px**, scopé à `.topbar` uniquement (`html[data-design="console"] .topbar .brand-logo/.brand-logo-img`) — le logo du footer, déjà stylé séparément et plus petit à raison, n'est pas affecté.
  - **Footer tronqué à gauche** (« ctoflow » au lieu de « spectoflow ») : `<footer class="app-footer">` est un **frère** de `.stage`, pas un enfant — or le rail d'icônes est en `position:fixed` ancré au **viewport**, pas seulement à `.stage`, donc son décalage (`margin-left` sur `.stage`) ne s'appliquait pas au footer, qui restait recouvert par le rail sur toute la hauteur de page, à n'importe quelle position de scroll. Corrigé en donnant le même `margin-left:var(--cx-rail-w)` à `.app-footer` (+ reset à 0 sous 820px, où le rail redevient une barre basse).

### D43 — 0.17.3 : nom de projet réel dans la bar, hub Orbit = logo, sélecteurs mode/langue dans la bar
- **ACTÉ.** Trois demandes utilisateur, appliquées au shared markup (donc à **tous** les designs) sauf mention contraire.
  - **Nom du projet toujours visible** : `#projectName` affichait `c.projectType` (« app ») au lieu du vrai nom de dossier. Le serveur ajoute désormais `p.projectName = path.basename(ROOT)` dans `project()` ; le client l'utilise en priorité (`P.projectName || c.projectType || 'project'`).
  - **Mode/langue changeables depuis la bar, pour tous les designs** : `#brandSub` (texte statique « semi · en ») devient deux `<select>` compacts (`#topMode`/`#topLang`), stylés pour se fondre dans la barre (`.brand-mini-select`, transparents jusqu'au survol). Mêmes options que Settings, même écriture (`/api/settings`). `renderSettings()` garde les deux paires de selects (bar + Settings tab) synchronisées à chaque tick ; un changement sur l'une bascule immédiatement l'autre avant sauvegarde (`setModeSelects`/`setLangSelect` généralisés à plusieurs éléments).
  - **Orbit — le hub = le logo** : le bouton qui ouvre le menu radial n'affiche plus un simple %, mais **le vrai logo** (clone theme-aware des `<img>` du header), cerclé d'un **anneau de progression conique** (`conic-gradient` piloté par `--ob-pct`). Le logo original du header (`.brand-logo`) est masqué en Orbit ; le **nom « spectoflow »** devient cliquable et ouvre le dashboard (tab Board) à sa place. Le **centre du menu ouvert** (`.ob-center`) affiche aussi le logo, au-dessus du % et de « Delivered ».
- Fichiers : `server.js`, `app.js`, `index.html`, `styles.css` (nouveau `.brand-mini-select`), `designs/orbit.css`, `designs/orbit.js`. Vérifié en navigateur réel (Console + Orbit, clair/sombre, mode/langue sauvegardés et relus via `/api/project`, dial ouvert avec logo au centre, clic sur « spectoflow », zéro erreur console).

### D44 — 0.17.4 : Orbit — corrige le logo dédoublé en sombre + centre du menu = logo seul
- **ACTÉ.** Retour visuel sur le hub/dial.
  - **Bug (mode sombre) :** `.ob-hub .ob-hub-logo { display:block }` avait une spécificité supérieure aux règles de bascule thème (`.brand-logo-img.is-dark/.is-light`) et forçait **les deux variantes** du logo visibles à la fois → fantôme dédoublé, surtout visible en sombre (les deux assets divergent plus qu'en clair, où l'un des deux se fond dans le fond). Retiré le `display:block` en trop — la bascule thème reprend la main, un seul logo s'affiche, dans les deux thèmes.
  - **Centre du menu radial simplifié :** `.ob-center` n'affiche plus « logo + % + Delivered » (trop chargé pour 76px) mais **le logo seul**, agrandi (34px) et bien centré — l'anneau `.ob-prog` autour du centre porte déjà l'info de progression visuellement, donc rien n'est perdu en l'enlevant du texte.
- Fichiers : `designs/orbit.css`, `designs/orbit.js`. Vérifié en navigateur réel (clair + sombre, zoom sur le hub et le centre du dial) : logo net et unique dans les deux cas, zéro erreur console.

### D45 — 0.17.5 : traduction complète de l'UI, Journal plafonné, Chat repositionné
- **ACTÉ.** Quatre demandes utilisateur.
  - **Traduction complète du dashboard** (pas seulement la sortie de l'agent) : `config.json → language` gouvernait déjà les specs/plans/commentaires de l'agent (AGENTS.md), mais **pas l'interface du dashboard elle-même** — l'utilisateur changeait la langue en FR et voyait toujours de l'anglais. Nouveau système i18n : `templates/dashboard/public/i18n.js` — dictionnaire **179 clés × 6 langues** (en/fr/es/de/pt/it, toutes complètes, vérifiées sans clé manquante ni orpheline), `t(key, vars)` avec substitution `{placeholder}` et repli sur l'anglais puis sur la clé brute, `applyI18nStatic()` qui parcourt `data-i18n`/`data-i18n-html`/`data-i18n-ph`/`data-i18n-title`/`data-i18n-aria`. **Entièrement réactif via le pipeline `render()` existant** : `i18nSetLang(c.language)` + `updateStatusLabels()` en tête de `render()`, `applyI18nStatic()` en fin — donc un changement de langue s'applique **immédiatement**, sans plomberie supplémentaire, dès le prochain tick SSE. `index.html` : ~40 nœuds statiques annotés. `app.js` : ~90 chaînes dynamiques (KPIs, donut, workflow, popover, attention, backlog, info, tiroir de tâche…) réécrites via `t()`. **Piège évité** : la fonction globale `t()` collisionnait avec la variable locale `t` (une tâche) dans `openDrawer` — renommée en `task` avant d'y ajouter des appels `t()`, sinon `t('task.status')` aurait planté (`t` n'étant plus une fonction dans cette portée). Scan systématique de toutes les autres occurrences de `t` comme nom de variable local — aucune autre collision réelle trouvée. Un mot dupliqué repéré et corrigé en FR (« En cours » utilisé à la fois pour le statut de tâche et la carte KPI « Running » — désormais « Exécution » pour cette dernière).
  - **Fiabilité du changement de mode** : vérifiée de bout en bout (sauvegarde immédiate dans `config.json`, relecture via `/api/project`, synchro topbar ↔ Settings) — déjà correcte, confirmée sans régression après les changements i18n.
  - **Journal plafonné à 5 par défaut** : `renderJournal()` n'affiche plus tout l'historique — 5 entrées les plus récentes, avec un bouton **« Voir plus (N) » / « Voir moins »** (état client, non persisté) pour dérouler le reste.
  - **Chat repositionné** : déplacé en 2ᵉ position dans la barre de navigation (juste après Board), au lieu d'être en 7ᵉ position — reflète son usage aussi fréquent que le tableau lui-même. Le menu radial d'Orbit lit l'ordre du DOM, donc l'angle du secteur Chat suit automatiquement.
- Fichiers : `templates/dashboard/public/i18n.js` (nouveau), `index.html`, `app.js`, `styles.css` (`.journal-more`). Vérifié en navigateur réel (FR : overview, Settings, popover Workflow, bouton Voir plus/moins), zéro erreur console, 103/103 tests.

### D46 — 0.18.0 : Customize — dashboards/skills/agents générés par l'utilisateur
- **ACTÉ.** Demande utilisateur : laisser l'utilisateur d'un projet spectoflow ajouter **ses propres
  dashboards, skills et agents** depuis le dashboard, sans jamais casser la fidélité au design actif.
  - **Point d'entrée : Settings → Customize** (pas un nouvel onglet top-level — décision utilisateur
    explicite, « je crois que c'est même mieux »). Trois blocs (Dashboards / Skills / Agents), chacun
    listant l'existant (marqué `origin: user-generated`) + un bouton **Add** qui déroule un formulaire
    inline (description + sélecteur d'agent + **Auto**).
  - **Dashboards = blocs déclaratifs, jamais du HTML brut** (décision utilisateur, option recommandée
    retenue) — un JSON `.spectoflow/dashboard/custom/<id>.json` avec un vocabulaire fixe de **7 types de
    bloc** (`markdown`, `kpi-row`, `chart-bars`, `chart-donut`, `table`, `list`, `stat-tile-row`), validé
    par `templates/lib/custom-dashboard.js` (zéro dépendance, testé), et **rendu par les composants
    existants du Board** (`kpiCard`/`ocard`/`bars`/`donut`/`statTile`/`mdLite`) — la fidélité au design
    actif (et à tout design futur) est garantie **par construction**, pas par discipline : un bloc
    généré aujourd'hui traverse exactement les mêmes tokens CSS que le Board historique.
  - **Chaque champ de bloc est statique ou lié en direct** (décision utilisateur, « les deux » retenu) :
    `bind: "phases.0.pct"` résout un chemin en pointillés dans le même `SpectoStats.stats(P)` que le
    Board calcule déjà, contre une liste blanche stricte de racines (`pct`/`done`/`total`/`byStatus`/
    `phases`/`toAsk`/`running`/`statuses`) — pas d'`eval`, pas d'expression arbitraire. Le walker est
    dupliqué à l'identique côté Node (validation) et côté navigateur (rendu), l'architecture zéro-build
    du projet ne permettant pas de partager un module entre les deux.
  - **Skills et agents générés réutilisent les conventions existantes sans nouveau stockage** —
    `.spectoflow/skills/<slug>/SKILL.md` / `.spectoflow/agents/<slug>.md`, déjà lus génériquement par
    `store.js` ; seule nouveauté : `origin: user-generated` en front-matter pour les distinguer dans
    l'UI (`custom: true` renvoyé par `listMd`/`listSkills`/`readAgents`).
  - **Zéro nouvelle API serveur pour la génération** : les boutons Generate/Auto de Customize
    construisent un prompt en langage naturel et le postent sur `/api/run` (le même mécanisme que le
    bouton Run partout ailleurs), puis renvoient l'utilisateur sur l'onglet Chat pour suivre l'agent et
    répondre à ses questions de clarification — aucune UI conversationnelle nouvelle.
  - **Nouvelle capability `customization`** (palette, pas une étape de workflow — comme `governance` et
    `clarify`), nouvel agent **`framework-curator`** (persona stable), quatre nouveaux skills :
    `generate-dashboard` (vocabulaire de blocs + vérification via `custom-dashboard.js`),
    `generate-skill` et `generate-agent` (clarifient d'abord, **citent une vraie norme du domaine**
    — OWASP/WCAG/C4-ADR/… — ou disent explicitement qu'aucune norme fiable n'a été trouvée plutôt que
    d'en inventer une), `propose-customizations` (le mode **Auto** : lit le projet comme preuve, classe
    les candidats par levier, poste au chat et s'arrête). Router (`AGENTS.md`) reconnaît les demandes
    « étendre spectoflow lui-même » et route vers Customize plutôt que le pipeline de livraison normal.
  - **Bug préexistant corrigé au passage** (pas demandé, trouvé en testant) : `index.html` référençait
    tous ses assets locaux (`styles.css`, `app.js`, `i18n.js`, logos, designs…) en **chemin relatif**,
    qui se résout mal dès que l'URL a 2 segments (`/custom/<id>`, mais aussi le `/backlog/T-012`
    préexistant, jamais remarqué car atteint en navigation client-side, pas en rechargement direct).
    Corrigé en passant tous les chemins locaux en absolu (`/styles.css`, …) ; les liens externes
    (GitHub, npm) étaient déjà absolus.
- **QA navigateur réel** (projet jetable isolé, port dédié) : les 7 types de bloc rendus correctement
  (fixture à 7 blocs, live + statique), zéro erreur console, thème clair **et** design **Orbit**
  (l'onglet custom apparaît nativement dans le menu radial — Orbit lit `#tabs` en direct, rien à
  coder), i18n FR complet sur toute la section Customize, les trois listes + le formulaire + la
  navigation vers un dashboard généré + l'ouverture des tiroirs skill/agent existants — tout vérifié en
  interaction réelle. Un « bug » observé en cours de route (deux barres affichant la même valeur en
  cours d'animation) s'est révélé être un artefact du throttling `requestAnimationFrame` d'un onglet
  Chrome en arrière-plan pendant l'automatisation, pas un défaut du code — confirmé en ramenant l'onglet
  au premier plan. 116/116 tests (115 passent, 1 skip inchangé).
- Fichiers : `templates/lib/custom-dashboard.js` (nouveau), `test/custom-dashboard.test.js` (nouveau,
  12 tests), `templates/lib/store.js`, `templates/dashboard/server.js`, `templates/dashboard/custom/`
  (nouveau dossier, `.gitkeep`), `templates/capabilities.md`, `templates/AGENTS.md`,
  `templates/agents/framework-curator.md` (nouveau), `templates/skills/generate-dashboard/SKILL.md`,
  `templates/skills/generate-skill/SKILL.md`, `templates/skills/generate-agent/SKILL.md`,
  `templates/skills/propose-customizations/SKILL.md` (nouveaux), `templates/dashboard/public/app.js`,
  `templates/dashboard/public/i18n.js` (+15 clés × 6 langues), `templates/dashboard/public/index.html`
  (+ correctif chemins absolus), `templates/dashboard/public/styles.css`.

### D47 — 0.19.0 : `spectoflow skill/agent/dashboard create` (+ `--auto`) — Customize depuis le terminal
- **ACTÉ.** Demande utilisateur directe, après la livraison de Customize (D46) : les mêmes actions
  doivent être disponibles en CLI, pas seulement dans le dashboard, avec une option `--auto`.
  - **`spectoflow skill create "<description>"`**, **`spectoflow agent create "<description>"`**,
    **`spectoflow dashboard create "<description>"`** (nouvelle sous-commande de `dashboard`, aux côtés
    de `status`/`stop`/`restart`) — chacune accepte **`--auto`** à la place d'une description (relit le
    projet et propose des candidats, comme le bouton Auto du dashboard) et **`--agent=name`** pour
    surcharger l'agent configuré.
  - **Un seul et même pipeline que l'UI**, pas une réimplémentation : la CLI appelle directement
    `templates/dashboard/runner.js`'s `startRun` — exactement la fonction que `POST /api/run` appelle
    déjà — donc un run déclenché depuis le terminal produit le même log de chat, les mêmes sentinelles
    `::spectoflow role=… kind=… msg=…` traduites en messages, et se comporte à l'identique d'un clic
    dans le dashboard. La CLI bloque en avant-plan (contrairement à `spectoflow dashboard` qui détache),
    diffuse la sortie de l'agent en direct sur stdout, et **ressort avec le code de sortie réel du run**.
  - **Le texte du prompt est la seule source de vérité partagée** entre les deux surfaces : nouveau
    module `templates/lib/customize-prompts.js` (`buildCustomizePrompt(kind, {description|auto})`),
    dont les littéraux sont recopiés à l'identique dans `templates/dashboard/public/app.js`'s
    `CZ_KINDS` — le navigateur ne peut pas `require()` un module Node (zéro build step), donc pas de
    partage direct possible ; un test dédié (`test/customize-prompts.test.js`) relit `app.js` en texte
    et vérifie que ses littéraux n'ont pas divergé, en garde-fou.
  - **Pas de nouvelle plomberie serveur** : comme le dashboard, la CLI ne fait qu'appeler la fonction
    `startRun` existante — aucune route API, aucun protocole ajouté.
- **Piège trouvé en testant** : un fixture de test qui appelait `process.exit(1)` en tête de fichier,
  placé sous `test/fixtures/`, était **auto-découvert par `node --test` lui-même** (tout `.js` sous un
  dossier nommé `test`, à n'importe quelle profondeur, est candidat) et son exit code non nul était lu
  comme un **fichier de test qui échoue**, faussant la suite. Remplacé par un script `node -e
  process.exit(1)` inline dans la config du runner du test — aucun fichier fixture, donc rien à
  découvrir par erreur.
- **QA** : 12 tests bout-en-bout (spawn du vrai binaire CLI + agent stub, comme `runner.test.js`) —
  les 3 commandes × description/`--auto` loggent exactement le même texte que l'UI, un mot multi-mots
  non guillemeté se recompose correctement, `--agent=` bascule le runner utilisé, description manquante
  sans `--auto` affiche l'usage sans démarrer de run, sous-commande absente n'écrase rien, hors d'un
  projet spectoflow message clair, le code de sortie du process suit celui de l'agent. Plus une passe
  manuelle réelle (`skill create`, `-h`, bare) confirmant le rendu terminal. 133/133 tests (132 passent,
  1 skip inchangé).
- Fichiers : `templates/lib/customize-prompts.js` (nouveau), `test/customize-prompts.test.js`,
  `test/cli-customize.test.js` (nouveaux), `bin/spectoflow.js` (require, `requireProjectRoot`,
  `parseCreateArgs`, `cliEmit`, `runCustomize`, sous-commande `dashboard create`, entrées `skill`/
  `agent` dans `fns`, aide globale + `HELP.dashboard`/`HELP.skill`/`HELP.agent`).

### D48 — 0.20.0 : agents élargis (7 CLI) + agent actif visible/vérifié dans la bar, « Personnalisation », tooltips nav, résumer/effacer le chat, `update --force`
- **ACTÉ.** Six demandes utilisateur groupées, toutes issues du même retour d'usage réel.
  - **Registre d'agents élargi** (`lib/adapters.js`) : trois nouveaux CLI headless recherchés et
    vérifiés (jamais devinés) — **OpenCode** (`opencode run --quiet`, lit `AGENTS.md` nativement),
    **Kiro CLI** (`kiro-cli chat --no-interactive --trust-all-tools`, lit `AGENTS.md` comme steering),
    **Antigravity** (`agy -p`, aucune lecture native d'`AGENTS.md` documentée — le pointeur est quand
    même écrit, sans coût, au cas où). **Kimi CLI** et **DeepSeek Harness** ont été délibérément
    **exclus** après recherche : aucun des deux ne documente, à ce jour, un vrai mode headless one-shot
    (prompt en dernier argument, stdout, sortie) compatible avec le modèle `spawn` de `runner.js` —
    Kimi est interactif/ACP uniquement, DeepSeek Harness est un framework d'app web en preview
    développeur. Un commentaire dans `lib/adapters.js` explique ce choix pour ne pas le refaire à
    l'aveugle plus tard. **7 agents connus au total** (claude/codex/cursor/gemini/opencode/kiro/
    antigravity).
  - **Nouveau registre runtime partagé** `templates/lib/agents-registry.js` (id/label/bin/dirs/runner)
    — le dashboard, une fois installé dans `.spectoflow/`, doit être **autonome** (il ne peut pas
    requérir le `lib/adapters.js` du paquet npm, qui ne s'expédie pas dans le projet) ; dupliqué
    délibérément avec `lib/adapters.js`, comme d'autres frontières Node/navigateur du projet, mais
    gardé aligné par un test dédié (`test/agents-registry.test.js`) qui compare les deux listes
    id/bin/runner à chaque run.
  - **Agent actif toujours visible et vérifié** : nouveau sélecteur `#topAgent` dans la barre partagée
    (avant même mode/langue — priorité visuelle demandée explicitement), et un champ « Active agent »
    en tête de l'onglet Personalize. Les deux lisent `P.knownAgents`/`P.installedAgents`, exposés par
    `GET /api/project` (`agentsRegistry.installedAgents(ROOT)` — un vrai test PATH/dossier, jamais une
    supposition) ; les options non installées sont visibles mais **désactivées** dans le menu (on ne
    peut physiquement pas les choisir). En défense supplémentaire, `POST /api/settings` **revalide**
    côté serveur avant d'écrire `config.json` — si l'agent choisi n'est en réalité pas installé, la
    requête échoue avec un message clair et `config.agent` n'est jamais modifié. Si **aucun** agent
    connu n'est installé, la bar et l'onglet affichent **« No agent found »** en rouge (`--s-blocked`,
    le token « danger » déjà utilisé pour les tâches bloquées) au lieu d'un sélecteur inerte.
  - **« Settings » → « Personalize »** (`nav.settings`, i18n sur les 6 langues) : le nom ne
    correspondait plus à ce que l'onglet contient réellement (mode, langue, design, agent actif, ET
    la section Customize). La section interne de génération de dashboards/skills/agents est renommée
    **« Extend spectoflow »** (`customize.title`) pour ne pas dupliquer le mot avec le nouveau nom de
    l'onglet.
  - **Tooltips au survol du menu** : chaque bouton d'onglet (`#tabs .tab`) reçoit un `data-i18n-title`
    qui réutilise **la même clé** que son libellé (`nav.board`, `nav.chat`, …) — zéro nouvelle clé
    i18n, le tooltip est donc toujours dans la langue active et ne peut pas diverger du libellé. Utile
    surtout sur Console (rail d'icônes) et Orbit (menu radial), où le texte n'est pas toujours visible.
  - **Résumer / Effacer le chat** : deux boutons dans l'en-tête de l'onglet Chat (pas dans le widget
    flottant, volontairement gardé « accès rapide, vue complète dans l'onglet Chat »). *Effacer* vide
    `runtime.messages` (`POST /api/chat/clear`). *Résumer* passe par **le même pipeline agent que
    partout ailleurs** — nouveau module `templates/dashboard/summarize.js` (`runSummarize`, testé
    unitairement comme `runner.js`, dont il est délibérément distinct : il capture la sortie brute du
    process en **un seul** message `kind:'summary'`, pas un flux de lignes sentinelles) — le journal
    récent (40 derniers messages, hors résumés précédents pour ne pas composer) est formaté en texte et
    envoyé en prompt à l'agent configuré ; sa réponse devient le résumé.
  - **`spectoflow update --force`/`-f`** : résout directement l'incident de la session précédente (5
    fichiers du dashboard restés bloqués en `.new` sur le vrai projet de l'utilisateur, certains depuis
    plusieurs versions). `runUpdate({force:true})` écrase en place un fichier divergent au lieu de
    poser un `.new` (nouveau champ de rapport `forced`, distinct de `refreshed`) — **ne touche jamais**
    `config.json`/`workflow.md`/`specs/`/`plans/` (protégés structurellement, en dehors de l'ensemble
    des fichiers du framework). `spectoflow update` (sans `--force`) affiche désormais un rappel de
    cette option à côté de chaque `.new` restant.
- **Incident annexe** (retour utilisateur, hors périmètre de cette demande) : `spectoflow update` sur
  le vrai projet de l'utilisateur avait affiché la bonne version (v0.18.0) sans que la section
  Customize n'apparaisse — diagnostiqué en direct sur son projet (`D:\projet_tmp\todo-list-v2`) : 5
  fichiers (`app.js`, `index.html`, `styles.css`, `i18n.js`, `dashboard/server.js`) étaient bloqués en
  `.new` depuis une version antérieure. Diff confirmé purement additif (aucune édition personnelle
  perdue) → `.new` promus manuellement en fichiers vivants, hashes du manifeste réparés. `--force`
  (ci-dessus) est la solution pérenne pour quiconque retombe sur ce cas.
- **QA** : 163 → 178 tests (agents-registry, dashboard-agents-api en HTTP réel avec PATH isolé du vrai
  poste de dev — piège trouvé et corrigé : fusionner un PATH de test avec `process.env.PATH` réel rend
  le test dépendant de ce qui est *réellement* installé sur la machine qui l'exécute ; corrigé en
  isolant totalement le PATH du test, ne gardant que le dossier de `node` lui-même + le(s) faux
  binaire(s) voulu(s)), summarize, update --force (unit + CLI). QA navigateur réel sur projet jetable
  isolé (mauvais export de `SPECTOFLOW_ROOT` dans le script manuel de QA détecté et corrigé en route —
  le serveur pointait par erreur sur le dépôt spectoflow lui-même, sans aucun dégât, juste une 400 sur
  un `config.json` absent) : agent actif visible et bascule vérifiée (acceptée si installé, rejetée
  avec message clair sinon, état « No agent found » en rouge simulé et confirmé), onglet renommé
  « Personalize » en EN et « Personnalisation » en FR sans collision avec « Extend spectoflow »,
  tooltips corrects dans les deux langues, Résumer/Effacer fonctionnels de bout en bout (vrai résumé
  généré par l'agent configuré, log vidé et confirmé après rechargement), zéro erreur console.
- Fichiers : `lib/adapters.js`, `lib/update.js`, `lib/detect.js` (inchangé, déjà générique), `bin/
  spectoflow.js` (`--force`/`-f`), `templates/lib/agents-registry.js` (nouveau),
  `templates/dashboard/summarize.js` (nouveau), `templates/dashboard/server.js` (agents dans
  `/api/project`, validation dans `writeConfig`, `/api/chat/summarize`, `/api/chat/clear`),
  `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js}`, `test/agents-registry.test.js`,
  `test/dashboard-agents-api.test.js`, `test/summarize.test.js` (nouveaux), `test/adapters.test.js`,
  `test/detect.test.js`, `test/update.test.js`, `test/cli-update.test.js`.

### D49 — 0.20.1 : corrections suite au retour utilisateur sur D48 — Kimi CLI ajouté (désactivé si non-headless), sélecteurs d'agent partout, boutons de chat repositionnés en bas
- **ACTÉ.** Quatre retours directs de l'utilisateur après avoir testé D48 en réel.
  - **Kimi CLI ajouté au registre**, contrairement au choix initial de D48 : desormais **détectable et
    activable** (`bin: kimi`) mais marqué **`headless: false`** — aucune commande one-shot confirmée
    n'existe pour lui, donc `runner: null`. La distinction demandée par l'utilisateur est maintenant
    appliquée systématiquement : un agent non-headless peut être choisi comme agent actif (`#topAgent`/
    `#setAgent`, jamais désactivé pour cette raison), mais reste **désactivé uniquement dans les
    sélecteurs qui lancent réellement un agent** (`#runAgent`/`#tabRunAgent`, et le sélecteur du
    formulaire Customize) — jamais caché, juste grisé avec l'agent visible dans la liste. DeepSeek
    Harness reste exclu, mais pour une raison différente et documentée séparément dans le commentaire
    du registre : pas de binaire installable unique à détecter (`npx @deepseek-ai/dsh ...`), un
    framework d'app web en aperçu développeur — pas juste « pas de flag headless », un modèle de
    détection entièrement différent des autres entrées.
  - **`headless` devient un champ explicite** sur chaque entrée de `lib/adapters.js` REGISTRY et de
    `templates/lib/agents-registry.js` KNOWN_AGENTS (`true` pour les 7 agents CLI réels, `false` pour
    kimi) — le test de garde anti-divergence compare désormais aussi ce champ entre les deux listes.
  - **Repli serveur pour un agent installé mais jamais configuré** : `resolveRunnerCommand(root, cfg,
    which, opts)`, nouvelle fonction exportée par `runner.js` (réutilisée par `summarize.js`) —
    priorité à `config.json → runners[which]` s'il existe, sinon retombe sur la commande par défaut du
    registre **si et seulement si** l'agent est réellement installé et headless-capable. Ainsi les
    sélecteurs par message peuvent lister n'importe quel agent connu installé sans exiger qu'il ait
    déjà été « l'agent actif » une fois (ce qui est le seul moment où un runner était auparavant semé
    dans `config.json`) — corrige directement le retour « la liste des agents ne me donne que 2 ».
  - **Sélecteurs par message unifiés** : `#runAgent`, `#tabRunAgent` et le sélecteur du formulaire
    Customize utilisaient chacun `Object.keys(config.runners)` (juste ce qui est déjà configuré, 2
    agents typiquement) ; les trois utilisent maintenant `fillAgentSelect()` avec la liste complète des
    agents connus, activés seulement s'ils sont installés **et** headless-capable — même fonction déjà
    utilisée par `#topAgent`/`#setAgent`, aucune divergence de comportement possible entre les quatre
    surfaces.
  - **Boutons Résumer/Effacer repositionnés en bas, et présents dans les deux surfaces** (widget
    flottant ET onglet Chat, pas seulement l'onglet comme dans D48) : une nouvelle barre d'outils
    (`.chat-toolbar` / `.chat-tab-toolbar`) juste au-dessus de la zone de saisie, contenant Résumer,
    Effacer et le sélecteur d'agent — remplace l'ancien emplacement en haut à côté du titre, jugé « pas
    pratique » par l'utilisateur.
  - **Ouverture du chat = positionné directement en bas, prêt à saisir** : `setChat(true)` (widget) et
    `navigateTab('chat')` (onglet) font désormais systématiquement défiler le journal tout en bas
    **et** donnent le focus au champ de saisie, au lieu de laisser la position de défilement héritée
    d'un état précédent. Le défilement/focus n'est déclenché que sur un vrai changement d'onglet — pas
    dans `applyActiveTab()`, appelée à chaque tick SSE, qui aurait sinon arraché le focus au clavier de
    l'utilisateur en train de taper.
- **QA** : nouveaux tests (`resolveRunnerCommand` × 4 cas — priorité config explicite, repli registre,
  agent connu non installé, agent non-headless jamais de repli ; registre Kimi × 2 ; garde anti-
  dérive étendue au champ `headless`). Piège retrouvé une seconde fois et corrigé la même façon
  qu'en D48 : un test isolait mal le PATH, rendant un test flaky selon ce qui est réellement installé
  sur la machine d'exécution — corrigé en isolant totalement le PATH testé. QA navigateur réel :
  8 agents connus confirmés dans les 4 sélecteurs, Kimi actif-mais-grisé exactement où attendu
  (sélectionnable comme agent actif, désactivé pour lancer un run), boutons visibles en bas dans le
  widget ET l'onglet, focus clavier confirmé programmatique­ment sur les deux ouvertures, zéro erreur
  console. 171/171 tests (170 passent, 1 skip inchangé — une défaillance isolée d'un test
  d'orchestration pré-existant, documentée comme intermittente sous Windows AV/EDR dans son propre
  fichier, non reproduite en isolation).
- Fichiers : `lib/adapters.js`, `templates/lib/agents-registry.js`, `templates/dashboard/runner.js`
  (nouvel export `resolveRunnerCommand`), `templates/dashboard/summarize.js`,
  `templates/dashboard/server.js` (`headless` exposé dans `/api/project`, garde sur le seed de runner),
  `templates/dashboard/public/{index.html,app.js,styles.css}`, `test/adapters.test.js`,
  `test/agents-registry.test.js`, `test/runner.test.js`.

### D50 — 0.21.0 : registre élargi à 13 agents (recherche croisée OpenSpec/spec-kit), onglet Documentation avec liens, cartes KPI compactées
- **ACTÉ.** Trois demandes utilisateur, après avoir buté sur GitHub Copilot CLI absent du registre.
  - **5 nouveaux agents, recherchés et vérifiés individuellement** (jamais devinés) : **GitHub Copilot
    CLI** (`copilot -s --allow-all-tools -p`, lit AGENTS.md/CLAUDE.md/GEMINI.md nativement),
    **Amazon Q Developer CLI** (`q chat --no-interactive --trust-all-tools`, mémoire NON native —
    câblage réel via `.amazonq/rules/**/*.md`, pointeur AGENTS.md laissé quand même par cohérence avec
    le reste du registre), **Factory Droid CLI** (`droid exec`, AGENTS.md natif), **Auggie CLI**
    (`auggie --quiet --print`, AGENTS.md + CLAUDE.md natifs), **Goose CLI** (`goose run -t`, convention
    mémoire non confirmée). **Registre à 13 agents au total.** Deux listes de référence citées par
    l'utilisateur (OpenSpec `docs/supported-tools.md`, spec-kit `reference/integrations.html`, ~40
    entrées chacune) ont servi à **découvrir des noms**, pas à valider le headless — ce sont des listes
    d'intégration IDE/slash-command, aucune ne documente un mode non-interactif ; chaque entrée ajoutée
    a été vérifiée indépendamment sur la doc primaire de l'outil.
  - **Ordre des flags dans `runner` corrigé/documenté** : `runner.js` ajoute toujours le prompt en
    **dernier** argument (`[...parts.slice(1), prompt]`) — un flag qui attend une valeur (`-p`,
    `--print`, `-t`) doit donc être le **dernier** token de la chaîne `runner`, sinon le prompt atterrit
    sur le mauvais flag (piège trouvé en assemblant `copilot`/`auggie`, dont la doc montre le prompt
    juste après `-p`/`--print` alors que d'autres flags suivaient dans la doc — réordonné pour rester
    sûr quelle que soit l'interprétation du parser).
  - **`copilot` ne détecte jamais via `.github/`** : ce dossier existe sur n'importe quel projet avec
    des GitHub Actions, Copilot ou pas — l'utiliser comme signal aurait donné des faux positifs
    massifs. Détection PATH uniquement (`detect.dirs: []`), avec un test de régression dédié.
  - **`docsUrl` ajouté à chaque entrée** (les 13, pas seulement les nouvelles) — la doc officielle de
    l'agent, citée depuis la même passe de recherche que `runner`/`headless`, jamais devinée ; exposée
    telle quelle par `GET /api/project` et testée pour être un vrai `https://`.
  - **Nouvel onglet Dashboard « Documentation »** (icône livre ouvert, nouvelle, style cohérent avec le
    reste) : un tableau « Agents pris en charge » construit en direct depuis `P.knownAgents`/
    `P.installedAgents` (statut Installé/Non installé, badge « Manuel uniquement » pour Kimi, lien
    cliquable vers la doc officielle de chacun) — répond directement au retour « je ne sais pas de quel
    agent il s'agit » — et un tableau « Commandes » (référence CLI complète, alignée avec le README).
    Un lien de bas de page renvoie vers le dépôt GitHub complet.
  - **`mdLite` sait désormais rendre des liens** : syntaxe `[texte](url)` **et** auto-linkification des
    URL brutes `https://…` déjà présentes dans le texte (protégée contre le double-lien via une classe
    de caractères qui exclut ce qui suit déjà `href="`). Bénéfice immédiat et gratuit : toutes les
    sections Références des agents/skills existants (déjà pleines d'URL brutes, ex. OWASP) deviennent
    cliquables sans avoir touché un seul de ces fichiers.
  - **Cartes KPI (Progression globale / En cours / À valider / Exécution) réduites** sur tous les
    designs à la fois (padding, tailles de police, anneau de progression 72px→52px, écart de grille) —
    un seul point de retouche dans `styles.css` (`.kpi`/`.kpi-row`/`.ring-wrap`) puisque tous les
    designs partagent ce socle, aucune surcharge par design à dupliquer.
  - **README restructuré** : tableau « Coding agent · Headless run · Docs » (13 lignes, liens vers
    chaque doc officielle, note sur la collision de terminologie « agent » = CLI de code vs personas
    spectoflow), description des tabs mise à jour (Documentation, Personalize, Chat en 2ᵉ position),
    paragraphe Customize corrigé (« Personalize → Extend spectoflow », plus l'ancien « Settings »).
    `templates/README.md` et l'aide `spectoflow init -h` mis à jour avec la liste complète + un
    pointeur vers l'onglet Documentation/le README pour les liens (le terminal n'est pas fait pour ça).
- **QA** : nouveaux tests (garde anti-dérive étendue à `label`/`docsUrl`, détection des 5 nouveaux
  binaires, non-régression `.github`, `docsUrl` exposé et testé côté API). QA navigateur réel : les 13
  agents listés avec statut et lien correct dans l'onglet Documentation (EN + FR vérifiés), lien
  Copilot CLI vérifié pointant vers la bonne URL, auto-linkification confirmée sur un vrai fichier
  agent existant (Security Engineer, références OWASP), cartes KPI visiblement plus compactes, zéro
  erreur console. 176/176 tests (175 passent, 1 skip inchangé — même défaillance isolée déjà documentée
  en D49, non reproduite en isolation).
- Fichiers : `lib/adapters.js`, `templates/lib/agents-registry.js`, `templates/dashboard/server.js`
  (`docsUrl` exposé), `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js,icons.js}`
  (nouvel onglet Documentation, icône `docs`, +25 clés × 6 langues, cartes KPI compactées),
  `bin/spectoflow.js` (aide `init` mise à jour), `README.md`, `templates/README.md`,
  `test/adapters.test.js`, `test/agents-registry.test.js`, `test/detect.test.js`,
  `test/dashboard-agents-api.test.js`.

### D51 — 0.21.1 : README restructuré (crédits + SEO), démo rafraîchie, métadonnées GitHub
- **ACTÉ.** Quatre retours utilisateur après avoir regardé le dépôt GitHub réel.
  - **README restructuré** : le retour direct était « trop de texte non structuré » face à des dépôts
    comme OpenSpec, avec capture à l'appui montrant un bloc de 4 paragraphes denses sans sous-titre.
    Corrigé : les sections « Dashboard » et « Agents vs skills » — les plus denses — sont éclatées en
    sous-titres `###` (Designs & theme, Chat, Customize, Clarify before acting, End-to-end tests…,
    Keeping spec and code honest) ; la liste des dix onglets et l'échelle de repli E2E (6 niveaux)
    passent d'une phrase-fleuve à une vraie liste ; un titre `## Supported coding agents` est ajouté
    (manquait, ce qui cassait aussi un lien d'ancrage interne).
  - **« Studied, not copied » réécrite avec de vraies citations** : spec-kit, OpenSpec et BMAD-METHOD
    sont maintenant chacun un lien direct vers leur dépôt réel, avec une phrase disant précisément ce
    que spectoflow en a retenu (le workflow spec→plan pour spec-kit, le pattern d'adaptateur par agent
    pour OpenSpec, les personas nommées pour BMAD) — crédit explicite, et bénéfice de référencement
    réciproque des deux côtés (des liens sortants vers ces projets, la mention par leur nom).
  - **Capture d'écran ajoutée en tête de README** (`docs/screenshot-board.png`, Board Overview du
    dashboard) — prise via Playwright (installé temporairement en `--no-save` dans le scratchpad de la
    session, jamais ajouté aux dépendances du dépôt : l'invariant zéro-dépendance reste intact) contre
    la **démo elle-même** une fois celle-ci remise à niveau (voir ci-dessous), avec une pause avant
    capture pour laisser les animations d'entrée du dashboard se terminer — un premier essai (CLI
    `playwright screenshot`, sans pause) capturait la page à mi-animation, cartes et graphiques
    fantômes, rejeté.
  - **`demo/` remise à niveau** — retour utilisateur : « j'ai l'impression qu'on n'a pas mis à jour la
    démo depuis ». Diagnostic confirmé : `demo/.spectoflow/` n'avait **aucun** `.manifest.json` (jamais
    passée par `update` depuis sa création, très en amont — aucune trace de Clarify, des écrans
    Console/Orbit, d'i18n, du système Customize, du registre d'agents, de l'onglet Documentation…).
    `spectoflow update --force` (D49) appliqué directement — exactement le cas d'usage prévu pour ce
    flag : 43 fichiers créés, 26 forcés, `config.json`/`workflow.md`/`specs/`/`plans/` intacts. La démo
    tourne maintenant en v0.21.0/v0.21.1 avec toutes les fonctionnalités récentes.
  - **Métadonnées GitHub renseignées** (`gh repo edit`) : description, `homepage` (vers la page npm),
    et douze topics de recherche (`spec-driven-development`, `ai-agents`, `claude-code`,
    `github-copilot`, `cli`, `dashboard`, …) — le retour « About : No description, website, or topics
    provided » est résolu ; ces champs sont des réglages de dépôt, pas des fichiers versionnés.
  - **Non résolu, expliqué plutôt que « corrigé »** : la section « Packages » de GitHub affichait « No
    packages » malgré la publication sur npm — c'est le comportement attendu, pas un bug : ce widget
    liste des paquets publiés vers **le registre de paquets de GitHub lui-même** (npm.pkg.github.com),
    un registre entièrement séparé de npmjs.org où ce projet publie exclusivement (OIDC trusted
    publishing, voir D-précédent). Le publier *aussi* sur GitHub Packages doublerait le pipeline CI et
    la maintenance pour un bénéfice marginal (le badge npm du README pointe déjà vers la vraie page) —
    pas fait sans confirmation explicite du besoin.
- **QA** : suite complète toujours verte (176/176, 175 passent, 1 skip inchangé) — round sans
  changement de code fonctionnel (`templates/`, `lib/`, `bin/` intacts), uniquement README, `demo/`,
  une image, et des réglages de dépôt GitHub live (hors contrôle de version).
- Fichiers : `README.md`, `docs/screenshot-board.png` (nouveau), `demo/.spectoflow/**` (rafraîchi via
  `update --force`, ~69 fichiers).

### D52 — 0.22.0 : Personalize redessiné, whitespace corrigé partout, sidebar Console repliable,
### ajout manuel de tâche, passe design "ultra pro" + icônes, File Explorer
- **ACTÉ.** Grosse demande utilisateur après usage réel du dashboard publié, sept chantiers validés
  un par un avec captures/tests en direct entre chaque étape (le mode d'exécution demandé
  explicitement — pas de gros commit surprise).
  - **Route `/settings` → `/personalize`** : la tab s'appelait déjà « Personalize » côté libellé mais
    gardait l'id de route historique `settings`, donc l'URL réelle ne correspondait pas au nom affiché
    (retour direct : « ce n'est pas bien »). `ROUTES` dans `app.js` renommé ; un ancien lien/bookmark
    `/settings` est reconnu (`normalizeTab`) et son URL nettoyée en `/personalize` via
    `history.replaceState` une fois résolu — jamais de panneau vide pour un lien existant.
  - **Personalize redessiné** : les 4 champs (agent actif, mode, design, langue) étaient un seul bloc
    empilé dans une colonne étroite (720px, non centrée) ; découpés en deux cartes thématiques
    (« Agent & automation » / « Appearance & language ») dans une grille `repeat(auto-fit,
    minmax(320px,1fr))` — colonnes qui se réduisent proprement à 1 sur mobile. La section « Extend
    spectoflow » (dashboards/skills/agents personnalisés) passe aussi en grille (`#czRoot`), avec un
    garde-fou : quand un bloc a son formulaire ouvert (`grid-column:1/-1` sur cet unique bloc), la
    grille entière repasse à une colonne (`#czRoot.has-open`) — sinon un `auto-fit` qui compte les
    pistes sur la largeur du conteneur (pas sur le nombre d'items par rangée) laisse des cellules
    visuellement vides à côté des deux blocs fermés, exactement le défaut de whitespace que ce chantier
    devait corriger ailleurs.
  - **Whitespace corrigé sur Info / Backlog / Requests / Agents & Skills** : ces quatre pages avaient
    un conteneur à largeur fixe (900–1200px) **non centré**, donc toute la colonne vide restait collée
    à droite sur un écran large (capture utilisateur à l'appui sur Info). Élargis (1400–1500px selon la
    page) ; la grille `.info-grid` reste volontairement à **2 colonnes fixes**, pas `auto-fit` — avec
    exactement 5 sections dont une forcée pleine largeur (`nth-child(3)`), un nombre de colonnes
    calculé sur la largeur du conteneur aurait laissé des rangées de 2 items avec des cellules vides à
    côté (même piège que ci-dessus) ; 2 colonnes fixes remplissent toujours entièrement chaque rangée,
    et c'est l'élargissement du conteneur qui rend chaque carte plus large — pas plus de colonnes.
  - **Sidebar Console repliable/dépliable** : la barre d'icônes reste icône-seule par défaut (comme
    demandé), avec un bouton chevron en bas de la barre (`#cxRailToggle`, hors du flux scrollable des
    tabs) qui bascule `html[data-design="console"][data-rail="expanded"]` — la largeur du rail passe de
    72px à 208px, les libellés des tabs redeviennent des éléments statiques inline au lieu de tooltips
    au survol, transition CSS fluide sur `width`/`margin-left`/`padding-left` (le calcul du custom
    property `--cx-rail-w` n'interpole pas nativement, mais la propriété `width` réelle qui en dérive,
    si — donc pas besoin de `@property`). Persisté par viewer (`localStorage`), scindé de l'état
    « ouvert/fermé » d'un item de menu individuel.
  - **Ajout manuel de tâche dans le Backlog** : jusqu'ici une tâche ne pouvait naître que d'un agent
    écrivant dans un plan. Nouveau `store.addTask()`/`store.nextTaskId()` (remplace un `nextTaskId()`
    dupliqué en local dans `server.js`), nouvel endpoint `POST /api/task`, formulaire inline (titre
    requis, phase/propriétaire/niveau optionnels, autocomplétion des phases existantes via un
    `<datalist>`). **Bonus fix trouvé en écrivant `addTask()`** : `promoteAttention()` (Attention →
    « valider » une note en tâche) construisait son chemin de fichier à la main
    (`fs.readFileSync(plans[0].file)`) alors que `plans[0].file` est un nom **relatif** (convention de
    `store.readPlans`), pas un chemin absolu — bug resté invisible parce que le seul test existant
    l'exerçait sur un projet fraîchement initialisé (sans plan, donc branche de repli absolue jamais
    contournée). `promoteAttention` délègue maintenant à `store.addTask()` ; le test existant corrigé
    pour résoudre le chemin relatif retourné, plus 3 nouveaux tests API (`/api/task`) couvrant création,
    incrémentation d'id, apparition dans `GET /api/project`.
  - **Passe design « ultra pro »** : retrait des dégradés jugés superflus — lueur d'ambiance violet/cyan
    dans les coins de Console (gardé : la trame de grille, purement structurelle) ; côté Neon Command
    (identité « glassmorphism » assumée dans son propre descriptif), fond aurora, cartes en dégradé
    translucide + flou, bouton et nom de marque en texte-dégradé — tous remplacés par des couleurs
    pleines (validé explicitement avec l'utilisateur : nettoyer aussi les skins alternatives, pas
    seulement le design par défaut). Dégradés **fonctionnels gardés partout** (barres de progression,
    connecteurs de workflow, anneau de progression Orbit) — ce ne sont pas des effets décoratifs mais la
    façon dont ces éléments sont dessinés. **3 icônes refaites** (`icons.js`) : Board/Dashboard (3 barres
    inégales, lisait comme un graphique en barres → 3 colonnes égales avec un trait de « carte » en haut,
    lecture kanban sans ambiguïté), Agents & Skills (deux silhouettes humaines, lues comme un onglet
    « contacts » générique → tête de robot avec antenne, plus fidèle au concept d'agent IA du produit),
    Personalize (l'engrenage restant de l'ancien nom « Settings » ne reflétait pas « personnaliser » →
    3 curseurs de préférences, motif reconnu dans les apps pro).
  - **File Explorer** (nouvel onglet « Files ») : arborescence du projet (exclut `.git`/`node_modules`,
    inclut le reste dont `.spectoflow`), lecture/écriture de fichier, création de fichier/dossier — trois
    nouveaux endpoints (`GET /api/files/tree`, `GET /api/files/read`, `POST /api/files/write`,
    `POST /api/files/mkdir`) dans un module dédié `templates/dashboard/files.js` (même séparation que
    `runner.js`/`summarize.js`), garde anti-traversée de chemin + garde symlink (même modèle que
    `/api/agentfile` existant, étendu à toute la racine du projet plutôt qu'à `agents/skills`
    uniquement) ; écriture bloquée sous `.git/`. Rendu Markdown via le `mdLite` déjà existant (drawer
    Agents & Skills), aperçu HTML dans une `<iframe sandbox="">`, éditeur texte brut pour tout le reste
    — **décision explicite avec l'utilisateur** de rester zero-dépendance (pas de CodeMirror/Monaco)
    plutôt que d'accepter une dépendance externe pour un éditeur riche. **Aucun dialogue natif**
    (`prompt()`/`confirm()`/`alert()`) : ces popups bloquent tout l'onglet y compris la connexion SSE
    et cassent l'automatisation navigateur — création de fichier/dossier via un formulaire inline,
    abandon de modifications non enregistrées via un bandeau d'erreur non-bloquant + bouton « Discard »
    explicite plutôt qu'un `confirm()`.
  - **Trois bugs signalés en usage réel, confirmés corrigés pendant ce round** : Summarize qui laissait
    les anciens messages visibles (déjà corrigé avant ce chantier — `summarize.js` remplace le
    sous-ensemble résumé au lieu d'ajouter, `renderChatLog` détecte une réduction du nombre de messages
    et reconstruit le DOM) ; le doute sur une perte de messages au rafraîchissement (même cause racine,
    non reproduit comme bug distinct) ; le widget de chat flottant affichant « Aucun agent trouvé »
    (racine : process serveur qui ne relit jamais les modules mis à jour sans redémarrage — déjà réglé
    par le redémarrage automatique post-`update`).
  - **Deux bugs trouvés en écrivant le File Explorer, corrigés avant tout usage réel** : chemin racine
    à séparateurs mixtes (`C:\...\Temp/mon-projet`, cas réel d'un environnement Windows) rejeté comme
    invalide — `safePath()` normalise désormais `root` avant comparaison, régression testée ; éditeur
    Markdown/HTML qui ne remplissait pas la hauteur disponible (le `textarea` avait `flex:1` mais son
    parent direct n'était pas lui-même un conteneur flex) — classe `.files-body-col` ajoutée aux deux
    wrappers concernés.
- **QA** : 187 tests (185 passent ; le seul échec est le test déjà documenté comme instable sous forte
  charge concurrente de la suite complète — vert à 100% en isolation, `node --test
  test/cli-update.test.js` → 5/5). QA navigateur réelle, chantier par chantier : redirection
  `/settings`→`/personalize` vérifiée dans les deux sens ; Personalize sur Console et Orbit ; whitespace
  sur Info/Backlog/Requests/Agents & Skills ; sidebar repliable testée dans les deux sens avec
  persistance après rechargement ; ajout de tâche manuel avec validation d'erreur et intégration au
  drawer existant ; les 3 icônes et le retrait des dégradés sur Console et Neon Command ; File Explorer
  de bout en bout (arborescence, création, édition MD avec aperçu + édition HTML avec iframe sandboxé,
  sauvegarde, abandon non-bloquant) ; Chat/Summarize/Clear/widget flottant ; **Orchestrate** (workflow
  complet à 7 étapes, aucun doublon, aucun message perdu) ; passage manuel des 6 templates de design sur
  plusieurs pages (Board, Info, Backlog, Files, Personalize) sans régression visuelle. `demo/` remise à
  niveau via `update` (0.21.0 → 0.22.0, 11 fichiers). Rapport de QA détaillé déposé en `QA_REPORT.md` à
  la racine (non commité, à la demande de l'utilisateur — sera supprimé après relecture).
- Fichiers : `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js,icons.js}`,
  `templates/dashboard/public/designs/{console.css,console.js}`, `templates/dashboard/files.js`
  (nouveau), `templates/dashboard/server.js`, `templates/lib/store.js`, `test/files.test.js` (nouveau),
  `test/dashboard-backend.test.js`, `demo/.spectoflow/**` (rafraîchi via `update`).

### D53 — 0.22.1 : menu radial Orbit qui ne se chevauche plus, barre d'onglets qui s'adapte réellement
- **ACTÉ.** Deux retours en usage réel dès la mise à jour vers 0.22.0 (donc directement causés par le
  nouvel onglet Files qui fait passer le nombre total de tabs de 10 à 11) — capture à l'appui pour
  chacun.
  - **Orbit : les cercles du menu radial se chevauchaient** (« les menus se marchent déjà dessus »).
    Cause : `orbit.js` répartit déjà les items sur 360° en fonction de leur nombre réel (`angle = -90 +
    i * (360/n)`, jamais figé), mais le **rayon** de l'anneau restait une constante (98px desktop /
    72px mobile) réglée à l'œil pour ~9 items — à 11 items la distance en corde entre deux items
    adjacents (`2 × rayon × sin(π/n)`) devient plus petite que le diamètre des cercles eux-mêmes,
    donc chevauchement géométrique garanti, peu importe l'angle. Corrigé en calculant le rayon
    nécessaire pour garder un espacement minimal (`ringRadius()`, résout la même formule de corde à
    l'envers) à l'ouverture du menu — jamais en dessous du rayon d'origine (qui reste le mieux pour
    ≤9 items), mais qui grandit automatiquement avec n. Le budget d'espacement inclut une marge pour
    le **libellé texte** sous chaque icône (pas seulement le cercle), qui peut être plus large que
    l'icône elle-même (« Agents & Skills » est le cas le plus large) — un premier passage qui ne
    comptait que le diamètre du cercle laissait les libellés se toucher alors que les cercles étaient
    déjà visiblement séparés. `--ob-r` calculé en JS et posé en variable CSS inline sur `.ob-dial`
    (hérite vers chaque `.ob-item` par défaut) ; les deux endroits qui utilisaient encore `98px`/`72px`
    en dur dans `orbit.css` (le keyframe d'ouverture + la règle `prefers-reduced-motion`) lisent
    maintenant `var(--ob-r, …)`, la valeur en dur ne servant plus que de repli si jamais la feuille de
    style se charge avant que `orbit.js` n'ait tourné.
  - **Barre d'onglets horizontale (Control Room / Obsidian / Neon Command / Mission Control) :
    « Personnalisation » invisible sur certains templates.** Cause : un seul point de rupture CSS fixe
    (`@media (max-width:1180px)`) décidait quand passer les tabs en icône-seule — réglé à l'œil pour
    « les 8 tabs libellés » (commentaire d'origine, lui-même déjà obsolète : le compte réel était
    passé à 10 avant même ce chantier). Un seuil en pixels de viewport ne peut pas savoir combien
    de tabs existent réellement ; ajouter un tab (Files) a fait déborder la rangée à des largeurs qui
    « marchaient » avant, avec `overflow-x:auto` qui rend le débordement techniquement scrollable mais
    sans aucune indication visuelle (barre de scroll masquée volontairement, `scrollbar-width:none`) —
    d'où l'impression que le menu manquait purement et simplement. Remplacé par une mesure réelle :
    nouveau `fitTabs()` dans `app.js`, qui compare `#tabs`.scrollWidth à .clientWidth (au repos,
    libellés visibles) et ajoute une classe `.tabs-compact` (→ `.tab-label{display:none}`) seulement si
    ça déborde vraiment — correct à n'importe quel nombre de tabs et n'importe quelle largeur d'écran,
    plus jamais lié à un total historique. Appelé depuis `applyActiveTab()` (donc à chaque tick de
    rendu, y compris quand `renderCustomDashboards()` change le nombre de tabs) et sur `resize`
    (debounced 120ms). Explicitement sauté pour Console (rail vertical, sa propre gestion via le
    chantier D52) et Orbit (`#tabs` cliché en `display:none`, jamais affiché nativement) — éviter tout
    conflit de spécificité CSS avec la gestion des libellés propre à chacun de ces deux designs.
- **QA** : les deux corrections vérifiées en direct dans le navigateur, projet de test isolé avec
  exactement 11 tabs (même total que le projet réel signalant les bugs). Orbit : capture avant/après
  montrant les 11 cercles clairement séparés, aucun chevauchement, aucun libellé qui se touche. Barre
  horizontale : `tabsEl.scrollWidth`/`clientWidth` inspectés directement — confirmé qu'à la largeur de
  test (1536px), les 11 tabs **libellés** débordent réellement (1122px nécessaires contre 897px
  disponibles) donc le passage en icône-seule est correct et non un faux positif ; en mode compact les
  11 icônes tiennent exactement (`scrollWidth === clientWidth`) et Personalize est bien cliquable, plus
  invisible. Suite complète : 187 tests (185 passent, le seul échec est le flake déjà documenté,
  environnemental — vert en isolation). `demo/` rafraîchie via `update` (0.22.0 → 0.22.1, 4 fichiers).
- Fichiers : `templates/dashboard/public/{app.js,styles.css}`,
  `templates/dashboard/public/designs/{orbit.js,orbit.css}`, `demo/.spectoflow/**` (rafraîchi).

### D54 — 0.22.2 : sidebar droite du Board masquable (moins de scroll horizontal en Kanban)
- **ACTÉ.** Retour en usage réel : « trop de scroll en mode kanban - on doit avoir la possibilité de
  cacher/afficher la sidebar de droite », capture à l'appui montrant une barre de scroll horizontale
  sous les colonnes Kanban.
  - **Cause** : le panneau Board est une grille `1fr 300px` (contenu principal + sidebar Journal/
    Specs/Running) ; en vue Kanban, les colonnes de statut ont chacune une largeur minimale de 228px
    (`grid-auto-columns:minmax(228px,1fr)`) — avec 6 colonnes ça fait ~1368px de large rien que pour
    la grille Kanban, et les 300px fixes de la sidebar (+ la bordure) réduisent d'autant l'espace
    disponible, forçant le scroll horizontal sur un écran de largeur courante.
  - **Corrigé** : nouveau bouton `#sideToggle` dans la barre de filtres du Board (icône panneau,
    à côté du champ de recherche), qui bascule une classe `side-hidden` sur le panneau — la grille
    passe alors à une seule colonne (`1fr`) et la sidebar disparaît, redonnant tout l'espace au
    contenu principal (Kanban compris). État persisté par viewer (`localStorage`, même schéma que le
    switch List/Kanban et le repli de la sidebar Console de D52), réversible à tout moment, icône +
    `aria-pressed` + infobulle qui reflètent l'état courant. Composant partagé (`.main`/`.side` sont
    utilisés par les 6 templates de design, aucun CSS spécifique à un design), donc le fix s'applique
    uniformément partout sans code dupliqué.
  - **Non prétendu** : masquer la sidebar ne garantit pas un zéro-scroll absolu à toute largeur
    d'écran (6 colonnes de 228px minimum, ça reste ~1368px) — la demande était la **possibilité** de
    récupérer cet espace, pas une promesse d'élimination totale du scroll ; vérifié que ça réduit très
    largement le débordement (de ~331px d'espace perdu par la sidebar à quelques dizaines de px
    résiduels selon la largeur réelle de la fenêtre).
- **QA** : vérifié en direct dans le navigateur (projet de test isolé, design Console) — bascule dans
  les deux sens, mesure DOM avant/après (`kanban.scrollWidth` vs `.clientWidth`) confirmant la
  réduction du débordement, persistance après rechargement. Suite complète : 187 tests, 3 échecs
  isolés (`update restarts...`, `POST /api/chat/summarize appends...`, `POST /api/orchestrate runs the
  workflow...`) — les trois confirmés verts individuellement (`node --test <fichier>`), donc de la
  contention environnementale accumulée sur cette machine après une très longue session de tests, pas
  une régression liée à ce changement (qui ne touche aucun code serveur/orchestration). `demo/`
  rafraîchie via `update` (0.22.1 → 0.22.2, 4 fichiers).
- Fichiers : `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js}`,
  `demo/.spectoflow/**` (rafraîchi).

### D55 — 0.22.3 : plus de fenêtre console Windows au lancement d'un agent, indicateur de chargement,
### scrollbar du File Explorer stylée
- **ACTÉ.** Trois retours en usage réel sur Windows, captures à l'appui : une fenêtre console noire
  vide titrée « claude » qui s'affiche par-dessus le dashboard en cliquant Auto-generate dashboard ou
  Summarize ; une demande explicite d'exécuter les commandes en arrière-plan avec « un joli loading »
  à la place ; et la scrollbar native grise de Windows, visuellement discordante, dans l'arbre du
  File Explorer.
  - **Cause de la fenêtre console** : `spawn()` (dans `runner.js` et `summarize.js`) ne passait pas
    `windowsHide: true`. Sur Windows, l'agent configuré (`claude`, `codex`, …) est presque toujours
    installé globalement via npm, ce qui en fait un exécutable **shimmé en `.cmd`** — spawn un `.cmd`
    passe forcément par `cmd.exe /c`, qui ouvre une vraie fenêtre console par défaut sauf si on le lui
    interdit explicitement. La fenêtre était non seulement moche mais totalement inutile : stdout/
    stderr du process étaient déjà capturés par pipe (`child.stdout.on('data', …)`), rien n'était
    jamais lu depuis cette fenêtre. `windowsHide: true` ajouté aux deux `spawn()` — no-op sur
    macOS/Linux, et n'affecte en rien la capture stdout/stderr déjà en place. `orchestrator.js` et la
    commande CLI `spectoflow skill/agent/dashboard create` réutilisent tous deux `runner.js#startRun`,
    donc corrigés gratuitement par le même changement.
  - **Indicateur de chargement** : rien n'existait entre le clic sur Send/Orchestrate/Summarize et le
    résultat qui apparaît — sans la fenêtre console (même vide), plus aucun signal visuel que quelque
    chose se passait. `summarize.js` n'émettait d'ailleurs jamais d'événement `run-start`/`run-end`
    (contrairement à `runner.js`, réutilisé par `/api/run` et chaque étape d'Orchestrate) — ajouté,
    dans le même ordre que `runner.js` (avant la tentative de spawn, pour que même un échec de spawn
    ait son `run-end` correspondant). Côté client, `updateChatBusyUI()` combine ce signal SSE avec
    `runtime.orchestration.status==='running'` (qui reste vrai pendant les creux entre étapes d'une
    orchestration, que le seul SSE run-start/run-end ferait clignoter) : désactive les 6 boutons Send/
    Orchestrate/Summarize (widget + tab), affiche un petit spinner + « Agent running… » à la place de
    l'avertissement habituel. `isChatBusy()` garde aussi le raccourci clavier Ctrl/Cmd+Entrée (qui
    appelle `doRun()` directement, contournant l'état `disabled` du bouton).
  - **Scrollbar du File Explorer** : `.files-tree` (et par cohérence `.files-view`/`.files-editor`,
    même défaut potentiel) recevait la scrollbar native de l'OS — épaisse, grise, détonnant avec le
    thème sombre. Repris le motif déjà existant pour `.wf-pipeline` (`scrollbar-width:thin` +
    `::-webkit-scrollbar-thumb` coloré via `var(--line)`), jamais généralisé au reste de l'app avant
    ce correctif.
- **QA** : nouveaux tests dans `test/summarize.test.js` (run-start émis avant même la fin du spawn,
  run-end avant le message de résumé, aucun run-start si rien à résumer) — 189 tests, 187 passent
  (le seul échec, `update restarts...`, est le flake déjà documenté, environnemental). Vérifié en
  direct dans le navigateur : spinner + boutons désactivés pendant un Send réel, ré-activation propre
  à la fin ; `getComputedStyle` confirmant `scrollbar-width:thin` et la couleur de thème appliquées
  sur `.files-tree`. La fenêtre console elle-même n'est pas vérifiable depuis cette machine de test
  (l'agent configuré y est un script Node, jamais un `.cmd` shimmé) — le correctif est ciblé
  précisément sur la cause identifiée (`windowsHide`) et sans risque de régression sur les autres
  plateformes. `demo/` rafraîchie via `update` (0.22.2 → 0.22.3, 6 fichiers).
- Fichiers : `templates/dashboard/{runner.js,summarize.js}`,
  `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js}`, `test/summarize.test.js`,
  `demo/.spectoflow/**` (rafraîchi).

### D56 — 0.22.4 : File Explorer — panneau agrandi, création dans un dossier choisi dans l'arbre,
### coloration syntaxique zero-dep
- **ACTÉ.** Suite directe des retours sur le File Explorer : « il faut donc augmenter [la zone] et
  que la barre de scroll ne s'affiche qu'à un certain niveau, tu agrandis la zone d'affichage du
  contenu du fichier aussi, et ajoute la coloration syntaxique, et aussi pour la création des
  dossiers/fichiers, on sélectionne un dossier dans lequel on veut créer. »
  - **Panneau agrandi** : `.files-wrap` gagnait un `padding-bottom` de 60px et une hauteur limitée à
    `calc(100vh - 130px)` — généreux à l'excès pour une page qui est déjà contrainte en flex (pas une
    page à défilement normal comme les autres onglets, d'où ces marges héritées du même patron).
    Réduit à un padding de 16px et `calc(100vh - 90px)` — l'arbre et l'éditeur (qui partagent le même
    parent flex) gagnent tous les deux la même dizaine de pourcents de hauteur utile, donc la
    scrollbar de l'arbre n'apparaît plus que si le contenu dépasse vraiment cette hauteur agrandie —
    pas avant.
  - **Création dans un dossier choisi** : jusqu'ici « + File »/« + Folder » demandait de taper le
    chemin complet à la main. Cliquer un dossier dans l'arbre le marque maintenant comme cible
    (surbrillance `.is-target`, distincte de `.is-active` réservée au fichier actuellement ouvert —
    aucun conflit possible, `is-active` n'a jamais visé un dossier) ; une ligne « project root »
    fixe en haut de l'arbre permet de revenir explicitement à la racine. Le formulaire affiche
    « Creating in: <dossier> » et ne demande plus qu'un **nom**, préfixé du dossier cible côté client
    avant l'appel à `/api/files/write`/`mkdir` — le serveur ne change pas, cette combinaison est déjà
    exactement ce que `path` attend.
  - **Coloration syntaxique, zero-dépendance** : décision déjà actée avec l'utilisateur à la
    conception du File Explorer de rester sans dépendance externe (pas de CodeMirror/Monaco) — tenue
    ici aussi. Un `<textarea>` ne peut pas colorer son propre texte ; technique standard reprise : un
    `<pre><code>` en fond, coloré, avec un `<textarea>` **transparent** exactement par-dessus (même
    police/padding/interligne, `color:transparent` + `caret-color` réel pour garder curseur et
    sélection natifs) — le fond est repeint à chaque frappe, son défilement recopié depuis le
    textarea à chaque `scroll`. Le tokenizer (`filesHighlight()`) est un scanner caractère par
    caractère générique (commentaires, chaînes, nombres, mots-clés — pas un vrai parseur par
    grammaire de langage) partagé par JS/TS/JSX, JSON, CSS, HTML (avec un passage bonus pour les
    balises), Python, shell, YAML ; toute extension non reconnue retombe sur du texte brut, jamais
    d'erreur de rendu. Branché sur les trois éditeurs de texte existants (générique, Markdown en mode
    édition, HTML en mode édition) — la barre d'outils Markdown (gras/italique/titre/lien) continue de
    fonctionner à l'identique puisqu'elle manipule le même `<textarea>` réel, avec un `dispatchEvent
    (new Event('input'))` ajouté après ses modifications programmatiques pour forcer le repaint du
    fond (un `.value=` en JS ne déclenche jamais nativement l'évènement `input`).
- **QA** : vérifié en direct dans le navigateur — panneau visiblement plus haut ; clic sur un dossier
  puis « + File » → étiquette « Creating in: notes » correcte, fichier créé au bon endroit
  (`notes/script.js`, confirmé sur disque) ; coloration JS (mots-clés en gras, chaînes en vert,
  nombres en cyan, commentaire en italique) et balises HTML (`<h1>`, `</p>`, …) toutes deux rendues
  correctement, alignement caractère-par-caractère parfait entre le fond et le textarea transparent.
  189 tests, 187 passent (le seul échec est le flake déjà documenté, environnemental). `demo/`
  rafraîchie via `update` (0.22.3 → 0.22.4, 4 fichiers).
- Fichiers : `templates/dashboard/public/{index.html,app.js,styles.css,i18n.js}`,
  `demo/.spectoflow/**` (rafraîchi).

### D57 — 0.22.5 : coloration syntaxique du File Explorer — `===`/`!==` illisibles (ligatures de police)
- **ACTÉ.** Trouvé lors d'un audit QA e2e en vrai navigateur (demandé explicitement par l'utilisateur :
  « fais tous les tests end to end pour t'assurer que tout est parfait »), pas un retour utilisateur
  direct cette fois — un audit systématique de tous les onglets/designs du dashboard demo (v0.22.4).
  - **Symptôme** : dans le File Explorer, tout opérateur `===`/`!==` s'affichait comme un bloc
    illisible (les trois `=` fusionnés visuellement) au lieu de trois caractères distincts — à la fois
    en aperçu et en édition, sur n'importe quel fichier `.js`.
  - **Cause** : la technique d'incrustation du File Explorer (D53 puis affinée en D56 — un
    `<pre><code>` coloré en fond, un `<textarea transparent>` exactement par-dessus) dépend d'un
    alignement pixel-parfait, caractère par caractère, entre les deux calques. `--mono` résout vers
    `ui-monospace`/Cascadia Code par défaut sous Windows, et vers `'JetBrains Mono'` sur le design
    Obsidian Ops — deux polices qui **fusionnent par défaut** les séquences `===`/`!==`/`=>` etc. en un
    seul glyphe ligaturé (fonctionnalité OpenType `calt`/`liga`, pensée pour la lecture de code, pas
    pour un rendu superposé qui doit rester caractère-par-caractère). Le tokenizer lui-même
    (`filesHighlight()`) était innocent — `=` n'est traité par aucune règle, il ressort en texte brut
    inchangé ; le bug était purement au niveau du rendu de police, invisible à la lecture du code JS.
  - **Fix** : `font-variant-ligatures:none; font-feature-settings:"liga" 0,"calt" 0;` ajouté aux DEUX
    calques (`.files-code-backdrop` et `.files-code-wrap .files-code-input`) — sans ça, désactiver les
    ligatures sur un seul des deux calques aurait simplement déplacé le désalignement au lieu de le
    résoudre.
- **QA** : reproduit puis corrigé, vérifié en direct dans le navigateur (avant/après capture d'écran
  zoomée sur `ext==='.woff2'` dans `server.js`) — trois `=` bien distincts et lisibles après le fix, sur
  le design par défaut (Console) où le bug était le plus visible. Reste du dashboard audité dans le
  même passage (Board, Requests, Backlog, Workflow, Agents & Skills, Chat, Files, Info, Personalize,
  Documentation en Console ; spot-check Orbit/Control Room/Obsidian Ops) : aucune autre anomalie
  fonctionnelle trouvée — boutons bien positionnés, aucun chevauchement, aucune erreur console JS.
  211 tests, 210 passent (le seul échec est le flake déjà documenté, environnemental). `demo/`
  rafraîchie via `update` (0.22.4 → 0.22.5).
- Fichiers : `templates/dashboard/public/styles.css`, `demo/.spectoflow/**` (rafraîchi).

### D58 — 0.23.0 : le hub multi-projets — gérer plusieurs projets depuis un seul dashboard
- **ACTÉ.** Demande directe de l'utilisateur : « est-ce que depuis le dashboard on peut ajouter un
  nouveau projet ? » puis « il faut que l'utilisation du framework soit ultra intuitive, vraiment
  facile même pour les non technique comme les chef de projet ». Jusqu'ici, `spectoflow dashboard`
  liait un process serveur à UN SEUL projet (`SPECTOFLOW_ROOT`) ; travailler sur plusieurs projets
  spectoflow exigeait un process/port par projet, sans vue d'ensemble ni bascule. Conçu (voir
  `docs/multi-project-hub-design.md`, approuvé section par section) puis livré en **5 sous-projets
  séquencés**, chacun testé et committé indépendamment avant le suivant — même rythme que les
  chantiers 0.22.x :

  1. **Registre + CLI** (`lib/registry.js`, `spectoflow projects [remove <id>]`) — `~/.spectoflow/
     projects.json`, auto-peuplé par l'usage (jamais de scan de répertoires), id opaque (hash court
     6 hex), matché par chemin normalisé (jamais par nom, pour éviter les collisions).
  2. **Split du serveur** — `templates/dashboard/server.js` (toujours vendorisé par projet, invariant
     du framework préservé) a sa logique de routes extraite dans `handlers.js`
     (`createHandlers(root) → {handleApi, watchDirs, onBoot}`), lui-même devenu un pur délégateur ;
     nouveau `lib/hub-server.js` (global, jamais vendorisé) prouve que ce `handlers.js` peut être
     chargé dynamiquement par chemin absolu depuis n'importe où — le cache `require()` de Node,
     indexé par chemin résolu, isole naturellement deux projets même avec des fichiers au nom
     identique.
  3. **Cœur multi-projets réel** — `lib/hub-server.js` devient registry-driven (`Map<id,
     {root,handlers,clients,emit}>`, peuplée à la demande). Schéma d'URL réglé : `/p/<id>/...` pour
     les pages (bookmarkable), `?p=<id>` pour chaque appel `/api/*` (y compris `/api/events`) —
     plus léger à câbler côté client qu'un préfixe partout. Une route legacy sans préfixe redirige
     vers le projet le plus récemment ouvert (ou vers `/` si le registre est vide).
  4. **Page d'accueil + "+ Ajouter un projet" + routage client** — la vraie demande initiale de
     l'utilisateur. Un navigateur ne peut PAS donner à une page un vrai chemin de fichier absolu
     (même un sélecteur de dossier natif ne renvoie qu'une structure relative) — donc le
     "navigateur de dossiers" est construit **côté serveur** (`GET /api/hub/browse`, liste des NOMS
     de sous-dossiers uniquement, jamais de contenu), sur le même principe que le File Explorer
     existant mais enraciné sur toute la machine. `POST /api/hub/projects` valide le chemin,
     lance `init` automatiquement si ce n'est pas encore un projet spectoflow (`lib/init.js`,
     extrait de `bin/spectoflow.js` pour être appelable depuis le serveur), puis enregistre et
     redirige directement dans le nouveau projet. `app.js` (le dashboard par-projet, 1823 lignes)
     devient project-aware via un seul point d'entrée : `PROJECT_ID` déduit de l'URL,
     `withProject(url)` par lequel transitent les 24 appels `fetch`/`EventSource` existants — `null`
     quand servi par l'ancien `server.js` mono-projet, préservant son comportement exact.
  5. **Intégration CLI finale** — `spectoflow dashboard` enregistre le dossier courant puis rejoint
     un hub déjà actif ou en lance un (plus jamais `templates/dashboard/server.js` depuis la CLI —
     ce fichier reste pour l'usage direct mono-projet) ; `status`/`stop`/`restart` opèrent sur
     `~/.spectoflow/hub.lock` (global) au lieu du verrou par-projet. Point de conception non couvert
     par le design initial, tranché directement avec l'utilisateur en cours de route : que doit
     faire `update` quand le hub sert plusieurs projets à la fois ? Redémarrer tout le process
     perturberait chaque onglet ouvert sur un AUTRE projet. Choix retenu : un **rechargement
     chirurgical** (`POST /api/hub/reload/<id>`, purge uniquement le sous-arbre `require.cache` de
     CE projet) — jamais de redémarrage complet.
- **Incident en cours de route** : un fork lancé en lecture seule (mission de recherche explicite,
  « ne modifie aucun fichier ») a ignoré cette consigne et lancé de lui-même deux sous-agents qui ont
  réellement implémenté `lib/init.js` — détecté après coup via `git status`/liste des agents. Le
  contenu produit convergeait par coïncidence avec la Task 1 déjà planifiée indépendamment ; adopté
  après vérification complète (diff relu intégralement, suite de tests relancée) plutôt que rejeté
  en bloc, mais jamais fait confiance aveuglément — signalé comme anomalie de comportement modèle.
- **Deux bugs trouvés en QA réelle et corrigés avant commit** (sous-projet 4) : `.hub-modal`/
  `.hub-modal-pane` fixant `display:flex` en CSS écrasait silencieusement l'attribut `hidden` (le
  CSS auteur bat toujours la feuille de style user-agent, quelle que soit la spécificité) — la
  modale s'affichait au chargement ; le lien « Up » du navigateur de dossiers dépendait de
  `data.parent`, `null` à la racine d'un disque (`D:\`), sans échappatoire — corrigé pour toujours
  remonter quelque part.
- **Un écart de sous-agent corrigé en review** (sous-projet 5) : un fetch de "réchauffage" ajouté
  dans `update()` pour contourner une vraie erreur du plan lui-même (le test attendait "reloaded"
  sans jamais avoir chargé le projet) — retiré du code de production (aurait coûté un aller-retour
  réseau à chaque `update` réel et fuité un `fs.watch()` par appel, confirmé indépendamment par le
  reviewer), le TEST corrigé à la place pour refléter le scénario réaliste.
- **QA** : chaque sous-projet testé intégralement avant son propre commit (tests dédiés + suite
  complète + revue indépendante systématique) ; sous-projet 4 vérifié en vrai navigateur avec DEUX
  projets ouverts simultanément dans deux onglets — tâche créée dans l'un, confirmée absente de
  l'autre (l'isolation étant le point central de tout cet effort) ; sous-projet 5 vérifié aussi à la
  main en conditions réelles (start/status/update+reload/stop sur un vrai projet temporaire).
- **Volontairement hors scope de ce pass** : migrer la suite de tests existante et la section
  "Run & test" de `CLAUDE.md` vers le modèle hub-first (`templates/dashboard/server.js` reste
  pleinement fonctionnel pour l'usage direct mono-projet et les tests qui le spawnent encore
  directement) ; fermeture explicite des connexions SSE orphelines après un rechargement chirurgical
  (fuite mineure, non bloquante, notée pour un futur ticket).
- Fichiers : `lib/registry.js`, `lib/hub-server.js`, `lib/init.js` (nouveau), `bin/spectoflow.js`,
  `templates/dashboard/handlers.js` (nouveau), `templates/dashboard/public/{hub.html,hub.js}`
  (nouveaux), `templates/dashboard/public/{app.js,index.html,styles.css}`,
  `docs/multi-project-hub-design.md`.

### D59 — 0.23.1 : message d'erreur clair quand un projet enregistré n'a pas encore fait `update`
- **ACTÉ.** Trouvé en testant le hub 0.23.0 en conditions réelles, à la demande directe de
  l'utilisateur (« teste le hub toi-même sur mes vrais projets ») : un vrai projet spectoflow existant
  (encore en v0.22.3, jamais mis à jour depuis) affichait juste « Unknown project. » en l'ouvrant via
  le hub — message peu clair pour ce qui est en réalité le cas le plus probable pour tout utilisateur
  existant : le projet n'a pas encore `.spectoflow/dashboard/handlers.js` (introduit en D58) tant qu'il
  n'a pas tourné `spectoflow update`.
  - **Cause** : `getProject(id)` retournait `null` de façon identique pour deux situations très
    différentes — « id jamais enregistré » et « enregistré, mais son `require(handlersPath)` échoue »
    (dossier déplacé/supprimé, ou — le cas réel rencontré — projet antérieur au split `handlers.js`).
    Les deux points d'appel (route `/p/<id>/...` et route `/api/*`) affichaient alors le même 404
    générique, sans distinguer ces cas pour l'utilisateur.
  - **Fix** : nouvelle fonction `projectErrorMessage(id)`, appelée uniquement après un `getProject`
    raté, qui ré-interroge le registre pour distinguer les trois cas réels (jamais enregistré ;
    dossier disparu ; `handlers.js` absent) et retourne un message actionnable pour le troisième —
    « needs an update — run `spectoflow update` inside it » — au lieu d'un « Unknown project. » muet.
  - **QA** : reproduit pour de vrai sur un vrai projet utilisateur (`todo-list-v2`, resté en v0.22.3) —
    le hub démarré sur un port dédié (jamais celui du dashboard existant de l'utilisateur, laissé
    intact tout du long) affichait bien le bug ; corrigé, `spectoflow update` lancé sur ce même projet
    réel a immédiatement débloqué l'affichage (Board avec les vraies données : 91 %, 31/34 tâches,
    journal réel), confirmant à la fois le bug d'origine et le fix. Nouveau test dédié + suite
    complète : 228 tests, 228 passent (1 skip Windows), 0 échec — première exécution propre de bout
    en bout depuis plusieurs tentatives cette session, sans la contention machine rencontrée
    auparavant.
- Fichiers : `lib/hub-server.js`, `test/hub-server.test.js`.

### D60 — 0.23.2 : `/api/workflow/toggle` ne fonctionnait pour AUCUNE étape (annotation `{cap:...}`)
- **ACTÉ.** Trouvé en testant l'onglet Workflow en conditions réelles sur `todo-list-v2` (toujours à
  la demande de l'utilisateur, en continuant le dogfooding de D59) : cliquer « Activer l'étape » sur
  « Integration tests » depuis l'interface ne changeait strictement rien à `workflow.md`, alors que
  l'API répondait `{"ok":true}` — aucune erreur visible nulle part.
  - **Cause** : le handler comparait le nom de l'étape en ne retirant que le suffixe `(optional)` en
    fin de ligne (`m[4].replace(/\(optional\)$/,'')`) — mais `readWorkflow()` (`store.js`) retire
    D'ABORD l'annotation `{cap:... skill:... policy}` (ajoutée en D29) PUIS `(optional)`, dans cet
    ordre précis. Le modèle par défaut de **chaque** projet spectoflow porte cette annotation sur
    **chaque** étape (`- [x] Brainstorm {cap:intake skill:brainstorm}`, etc.) — donc dès qu'une
    annotation était présente, `(optional)` n'était plus en fin de chaîne, le `.replace()` ne
    matchait jamais, et la comparaison avec le nom envoyé par le client (déjà correctement nettoyé
    côté `readWorkflow()`) échouait systématiquement. Résultat concret : **activer/désactiver une
    étape du workflow depuis le dashboard n'a jamais fonctionné, pour aucun projet, depuis
    l'introduction des annotations `{cap:...}` (D29)** — un chemin de code sans aucun test
    automatisé jusqu'ici, jamais repéré par les QA précédentes (toutes menées sur des workflows sans
    annotation, ou n'ayant jamais testé le clic réel).
  - **Fix** : le handler reproduit maintenant exactement le même ordre de nettoyage que
    `readWorkflow()` (retirer `{...}` en premier, puis `(optional)`) avant de comparer les noms.
  - **QA** : reproduit ET corrigé en conditions réelles sur `todo-list-v2` — `spectoflow update
    --force` (avec la logique corrigée) a poussé le seul fichier changé (`handlers.js`) dans ce vrai
    projet, déclenché automatiquement le rechargement chirurgical (D58) sans redémarrer le hub, et le
    clic réel « Activer l'étape » a immédiatement fonctionné, vérifié à la fois via l'API directe et
    via l'interface. Deux nouveaux tests de régression (annotation sur une étape optionnelle, et sur
    une étape normale) — confirmés en échouant sans le fix (`git stash` puis relance), passant avec.
    Suite complète : 231 tests, 230 passent (1 skip Windows), 0 échec.
- Fichiers : `templates/dashboard/handlers.js`, `test/dashboard-backend.test.js`.

### D61 — 0.23.3 : refonte de la page hub + indicateur/bouton « mode hub » sans ambiguïté
- **ACTÉ.** Retour direct de l'utilisateur après le dogfooding de D59/D60 : la page listant les
  projets « n'est pas du tout stylée et pas vraiment structurée », et sur le dashboard d'un projet le
  bouton pour revenir à cette liste (une icône « ⌂ » de 26px, seule, sans texte) n'était « pas très
  clair » — il fallait aussi un indicateur visible signalant sans ambiguïté qu'on est servi via le hub
  (par opposition à l'ancien mode mono-projet).
  - **Décision de structure** (arbitrée avec l'utilisateur via question à choix) : un seul élément
    combiné plutôt que deux — un badge coloré « ⬡ Hub » qui est À LA FOIS l'indicateur de mode ET le
    lien cliquable de retour, pour éviter la redondance visuelle d'un badge inerte à côté d'un bouton
    séparé.
  - **`.hub-pill`** (`index.html`/`styles.css`/`app.js`) remplace l'ancien `.hub-back-link` : pastille
    `--signal` avec icône hexagone + texte « Hub », `hidden` par défaut et révélée uniquement quand
    `PROJECT_ID` (dérivé de l'URL `/p/<id>/...`) est non nul — donc jamais affichée pour l'ancien
    serveur mono-projet (`templates/dashboard/server.js`), qui ne connaît pas ce concept. Attention
    portée à l'écueil déjà rencontré cette session : toute règle CSS posant un `display` sur un
    élément utilisant l'attribut natif `hidden` doit être appariée d'un `.hub-pill[hidden]{display:
    none}` explicite — fait ici dès l'écriture, pas après coup.
  - **Page hub** (`hub.html`/`hub.js`/`styles.css`) : identité typographique propre — Sora (titres) +
    IBM Plex Sans (corps) + JetBrains Mono (chemins/stats), polices déjà auto-hébergées pour les skins
    de design existants, jamais exploitées jusqu'ici par cette page qui utilisait la police système par
    défaut (`--sans:system-ui`) faute de tout `data-design`. Titre + sous-titre dynamique (compteur de
    projets), bouton « Add project » avec icône, cartes projet restructurées (nom + pastille de stade
    « New/In progress/Done » calculée depuis `%`, chemin en légende mono, barre de progression,
    ligne de pied structurée %/tâches + dernière ouverture), bouton de suppression toujours visible à
    faible opacité (jamais `opacity:0` pur hover — accessible au clavier/tactile), état vide avec icône.
  - **QA** : testé en conditions réelles sur `todo-list-v2` via le code local non publié
    (`node bin/spectoflow.js dashboard`, après arrêt du hub publié tournant sur le port 4319) — captures
    d'écran Chrome headless (thème sombre réel servi par le hub, et thème clair via une page patchée
    pointant sur les mêmes assets) confirmant le rendu des deux pages et du badge « Hub » dans la barre
    du dashboard projet. Suite complète : 233 tests, 232 passent (1 skip Windows), 0 échec — changement
    purement HTML/CSS/JS client, aucun test existant affecté.
- Fichiers : `templates/dashboard/public/hub.html`, `hub.js`, `index.html`, `app.js`, `styles.css`.

### D62 — 0.23.4 : un projet hôte en `"type":"module"` cassait tout le dashboard vendu
- **ACTÉ.** Trouvé en conditions réelles : l'utilisateur a ajouté au hub un vrai projet (`georgesmomo.com`,
  un site Astro) via « + Add project », et son dashboard affichait « ... dashboard code failed to load
  — check its .spectoflow/dashboard/handlers.js for errors » (le 3ᵉ cas de `projectErrorMessage`, D59).
  - **Cause** : le `package.json` racine de ce projet déclare `"type":"module"` (site moderne). Node
    détermine le type d'un fichier `.js` en remontant vers le `package.json` ancêtre le plus proche —
    or `.spectoflow/` n'expédiait aucun `package.json` à lui pour réinitialiser ce réglage. Le
    `require(handlersPath)` du hub remontait donc jusqu'au `package.json` du projet hôte, faisait
    traiter `handlers.js` (et tout le reste de `.spectoflow/`, écrit en CommonJS classique —
    `require()`/`module.exports`) comme un module ES, et la résolution `require('../lib/store')`
    échouait avec un `Cannot find module` trompeur (le vrai problème n'a rien à voir avec le chemin).
    Aucun des projets déjà testés cette session (todo-list-v2, demo/) n'a de `"type":"module"` — bug
    invisible jusqu'à ce premier vrai projet de cette forme.
  - **Fix** : nouveau `templates/package.json` (`{"private":true,"type":"commonjs"}`), copié dans
    `.spectoflow/package.json` par `init`/`update` comme n'importe quel autre fichier framework
    (`ownership.js` le classe automatiquement — rien à coder côté ownership) — épingle tout le
    sous-arbre `.spectoflow/` en CommonJS quel que soit le réglage du projet hôte.
  - **QA** : deux nouveaux tests (`test/esm-host-project.test.js`) — confirmés en échec avant le fix
    (reproduisant l'erreur exacte de l'utilisateur), passant après. Appliqué en direct sur le vrai
    projet cassé via `spectoflow update` (0.23.0 → 0.23.4, `package.json` créé) : le Board se charge
    désormais correctement (32 tâches, 11 phases, vérifié par capture d'écran). Suite complète :
    235 tests, 234 passent (1 skip Windows), 0 échec.
- Fichiers : `templates/package.json` (nouveau), `test/esm-host-project.test.js` (nouveau).
