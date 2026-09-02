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
