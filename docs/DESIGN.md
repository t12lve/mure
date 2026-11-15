# Mure — document de conception

Version 0.1.0. Ce document explique **pourquoi** Mure est construit ainsi. Le comportement normatif est
dans `PROTOCOL.md` ; l'usage courant dans `../SKILL.md`.

## 1. Intention

Un seul agent est mauvais sur les tâches larges : son contexte se remplit, il relit ce qu'il vient
d'écrire, il oublie une contrainte du brief, et il n'a personne pour contester son travail. Le
découpage manuel (« fais ce fichier, puis celui-là ») marche, mais le coût de coordination repose
entièrement sur l'humain.

Mure transpose dans un harnais quelconque le mécanisme de `/swarm` d'Antigravity : **un coordinateur,
des workers nommés à contexte neuf, un vérificateur adversarial, un tableau noir unique**. Ce qui est
reproduit, c'est la discipline de coordination ; ce qui est adapté, c'est le substrat, parce
qu'OpenCode, Claude Code, Codex et Cursor n'ont pas d'agents capables de dormir sur un tableau.

Objectif en une phrase : **rendre une tâche large découpable plus rapide et plus fiable qu'un seul
agent, sans que l'humain ait à arbitrer chaque tour.**

## 2. Objectifs

- Permettre à un agent de bout en bout de découper, dispatcher, collecter, vérifier et clore, sans
  intervention humaine entre les tours.
- Garantir qu'un fait rapporté n'est pas accepté sans que la commande de vérification ait tourné.
- Rendre l'état du travail lisible à tout instant, par un humain comme par un agent, sans lire les
  conversations.
- Porter sur n'importe quel harnais disposant d'un outil de sous-agent **ou** d'un CLI non interactif.
- Coût contrôlable : un worker inactif ne consomme rien, structurellement.

## 3. Non-objectifs

- Ce n'est pas un orchestrateur de workflows (pas de DAG, pas de reprise sur panne, pas de retry
  automatique).
- Ce n'est pas un outil de fusion : les branches `mure/<slug>/<membre>` sont créées, jamais fusionnées
  automatiquement.
- Ce n'est pas un gestionnaire de quota : `max-parallel` est un frein, pas une comptabilité.
- Ce n'est pas un protocole réseau : le tableau est un fichier local.
- Ce n'est pas un remplaçant de `git` : chaque commande qui touche au dépôt passe par `git` en
  sous-processus, sans réimplémenter quoi que ce soit.

## 4. Anti-objectifs

Ce qui rendrait Mure raté même si tout fonctionne :

- **Un faux essaim.** Un coordinateur qui fait le travail lui-même et poste des rapports à la place des
  workers produit un tableau crédible et un résultat non vérifié. C'est l'échec le plus probable, et
  c'est pourquoi le skill contient une table de rationalisations.
- **Une vérification de façade.** Un vérificateur qui lit le rapport au lieu du diff, ou qui valide
  sans lancer la commande, transforme la porte de vérification en cérémonie.
- **Un coût qui explose.** Douze agents sur quatre fichiers : plus lent, plus cher, et des diffs à
  jeter.
- **Une réserve perdue.** `validated-with-reserve` dont la réserve disparaît du rapport final est un
  mensonge par omission.

## 5. Contraintes

| Contrainte | Conséquence |
|---|---|
| Les sous-agents de ces harnais tournent jusqu'au bout puis s'arrêtent | pas de « sommeil » ; l'inactivité devient « pas de processus lancé » |
| Aucun harnais ne partage un état entre sous-agents | le tableau est un **fichier**, pas une API |
| Les workers peuvent écrire en parallèle | worktrees git par worker, sinon attribution impossible |
| Windows, macOS, Linux | Node 18+ sans dépendance, chemins relatifs, pas de shebang obligatoire |
| Le coordinateur peut mentir ou oublier | les portes de vérification et de clôture sont dans le CLI, pas dans la prose |

## 6. Approches envisagées

**A. Protocole pur, un seul `SKILL.md`.** Zéro dépendance, lisible partout. Rejeté seul : rien ne
force le format, un agent pressé écrit un tableau approximatif et les numéros de post divergent. La
discipline sans substrat déterministe ne tient pas plus de deux tours.

**B. Skill + CLI complet.** Tableau append-only réel, mentions calculées, états vérifiables, portes de
vérification et de clôture appliquées par le code. Coût : un fichier Node à maintenir. C'est la partie
qui rend le protocole non négociable.

**C. Hybride — retenu.** `SKILL.md` porte la méthode et reste autosuffisant (un harnais sans Node peut
suivre le protocole à la main) ; `scripts/mure.mjs` rend déterministe tout ce qui doit l'être. Le CLI
est optionnel pour comprendre, obligatoire pour tenir.

## 7. Décisions de conception

1. **Le tableau est la seule vérité.** Aucun état caché, aucun « je me souviens ». Un agent qui reprend
   le travail relit le tableau et sait tout.
2. **La mention est le seul signal de réveil.** Un membre agit si et seulement s'il a un post non lu à
   son nom. Pas de minuterie, pas de fichier modifié, pas de « au cas où ».
3. **Un tour = un post, puis stop.** Le worker ne boucle pas, ne s'auto-vérifie pas, ne dispatche pas.
   Cela garde le coût prévisible et empêche les sous-essaims incontrôlés.
4. **Le coordinateur ne code pas.** C'est la règle qui coûte le plus cher à tenir, donc elle est écrite
   comme une interdiction, avec la liste des excuses qu'on se donne pour la contourner.
5. **Le verdict est un objet, pas une opinion.** Quatre valeurs, un motif obligatoire, une réserve
   obligatoire pour `validated-with-reserve`, et la réserve doit être citée mot pour mot en aval.
6. **La porte de clôture est dans le CLI.** `close` refuse tant qu'une question est ouverte, qu'un
   worker n'a jamais rapporté, qu'un verdict est `rejected`, ou qu'un `block` traîne. `--force` existe,
   mais marque la clôture comme forcée pour que le rapport final ne puisse pas l'ignorer.
7. **Baseline au dispatch.** `prompt` photographie l'arbre de travail (`git stash create` + liste des
   non-suivis) ; `scope` ne juge que ce qui a changé depuis. Sans cela, un fichier déjà modifié avant le
   tour est imputé au worker.
8. **Worktrees optionnels, mais recommandés dès deux workers.** Le partage d'arbre est le mode le plus
   simple pour un worker seul ; c'est un piège dès qu'ils sont deux.
9. **Sortie CLI en anglais ASCII, documentation en français.** Les messages d'erreur circulent entre
   agents et harnais ; les accents cassent sur certains terminaux Windows. La doc s'adresse à un
   humain francophone.
10. **Un seul fichier pour le CLI.** 1 200 lignes dans `scripts/mure.mjs`, ce qui dépasse le seuil où un
    découpage se justifie. C'est assumé : le skill doit pouvoir être copié dans n'importe quel dépôt ou
    harnais sans graphe d'imports, et un CLI de 20 commandes sans état partagé se relit d'un bloc. Si
    une deuxième surface apparaît (serveur, SDK), le découpage redeviendra la bonne réponse.

## 8. Correspondance avec Antigravity

| Antigravity `/swarm` | Mure | Écart assumé |
|---|---|---|
| coordinateur = conversation courante | idem, rôle `coordinator` | — |
| workers nommés, contexte neuf | idem, un sous-agent par tour | — |
| brief public | post `brief` + `briefs/<nom>.md` | le brief est aussi dans le prompt |
| tableau partagé append-only | `board.jsonl` | fichier au lieu d'un service |
| mentions `@nom`, `@groupe`, `@all` | idem, `@prefix*` expansé à l'écriture | pas de messagerie privée, comme en amont |
| membre endormi à coût nul | membre non dispatché | pas de réveil automatique : c'est le coordinateur qui relance |
| `@verifier` pour 2–4 workers | idem, 1 par lot | — |
| `@monitor` qui poste si tout se tait | rôle `monitor` + détection dans `doctor` | pas de minuterie |
| worktrees isolés | `--worktrees`, `mure worktree` | branches `mure/<slug>/<membre>` |
| modèles hétérogènes | `--model` par membre + `model` à l'appel du sous-agent | dépend du harnais |
| UI Board / Members / Graph | `board`, `members`, `status`, `graph` (mermaid) | CLI, pas de panneau |
| quota par worker | `max-parallel` + `runnable` | — |

## 9. Ce qui a été appris en le testant

Le premier essaim réel (deux workers, un vérificateur, subagents OpenCode) a produit deux résultats.

**Ce qui a marché.** Les deux workers ont lu leur prompt, travaillé strictement dans leurs fichiers,
lancé la suite et posté un rapport unique numéroté. Le vérificateur a pu être réveillé par une note
sans être réveillé par le brief. Les portes (`close`, `prompt` sans post non lu) ont refusé ce qu'elles
devaient refuser.

**Ce qui a cassé.** En arbre partagé, `mure scope` a accusé chaque worker des fichiers de l'autre, et
les deux l'ont signalé dans leur rapport au lieu de le corriger — comportement correct de leur part.
Trois corrections en sont sorties : baseline au dispatch, avertissement explicite au coordinateur
quand deux workers partagent l'arbre, et `--worktrees` qui crée la copie de travail dès `member add`.
Le protocole documente désormais cette limite au lieu de la nier.

**Ce qui reste fragile.** Le curseur de lecture est avancé par `prompt` : si le harnais perd le prompt
entre l'affichage et la livraison, les posts sont « livrés » sans avoir été lus. La récupération existe
(`mure cursor @m --reset`) mais elle est manuelle. Un harnais qui capture la sortie du CLI de façon
fiable rend ce risque négligeable ; un humain qui copie-colle doit y penser.

**Ce que la relecture a trouvé.** Une passe d'audit adversarial, après coup, a montré que le CLI
n'appliquait pas la matrice des rôles qu'il documentait : un worker pouvait poster un `verdict`, clore
l'essaim, ou écrire un `brief`. Un moniteur pouvait poster un `report`. Le document disait une chose,
le code en faisait une autre — et aucun test ne couvrait l'écart, parce que les tests avaient été
écrits à partir des mêmes hypothèses que le code. Trois autres défauts de la même famille : `@all`
adressait les membres tués, un nom de membre avec une espace cassait le graphe mermaid, et un `block`
rendait la clôture impossible pour toujours (aucun mécanisme de résolution).

La leçon vaut d'être notée : **une règle de protocole qui n'est pas refusée par le code n'existe pas.**
Les cinq correctifs sont couverts par cinq tests, et chaque test a été vérifié par mutation — inverser
la garde fait tomber exactement le test correspondant.

## 10. Ce qui reste à construire

- **Reprise après panne** : un `mure resume` qui recalcule les membres runnable après un crash du
  coordinateur. Aujourd'hui `runnable` le fait déjà, mais rien ne distingue un tour perdu d'un tour
  jamais lancé.
- **Fusion assistée** : `mure land` qui merge les branches dans l'ordre des verdicts, avec détection de
  conflit et rapport.
- **Vue web** : le graphe mermaid suffit pour lire ; un `mure serve` statique serait plus agréable.
- **Budgets** : compteur de tours par membre, refus au-delà d'un seuil.
- **Vérification croisée** : deux vérificateurs sur désaccord, arbitrage par le coordinateur — le
  protocole le permet déjà (plusieurs `verifier`), rien ne l'outille.
- **Harnais** : un adaptateur explicite pour Cursor et Windsurf, dont les outils de sous-agents changent
  vite.

## 11. Critères de réussite

1. Un agent qui lit `SKILL.md` seul peut mener un essaim de bout en bout sans poser de question.
2. Aucun résultat n'est présenté comme vérifié sans un `verdict` et une commande exécutée.
3. Un humain qui lit `mure status` et `mure board` comprend l'état du travail en moins d'une minute.
4. Deux workers ne se marchent jamais dessus sans que ce soit visible.
5. Le coût d'un tour est proportionnel au travail du tour, pas à la taille du tableau.
