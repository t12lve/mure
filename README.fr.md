# Mure 群れ

Un essaim d'agents de code sur un seul tableau noir : un coordinateur découpe, des workers nommés
construisent en parallèle, un vérificateur indépendant lance les tests et juge, et rien n'est considéré
comme fait avant que ce juge ait parlé.

Mure est l'idée du `/swarm` de Google Antigravity, transposée aux harnais dont les agents ne savent pas
dormir sur un tableau — OpenCode, Claude Code, Codex CLI, Gemini CLI, Cursor. C'est un **skill**
(`SKILL.md`) et un **CLI sans dépendance** (`scripts/mure.mjs`).

*[English](README.md)*

> Le tableau est la seule vérité, la mention est le seul réveil, et le coordinateur ne fait pas le
> travail technique.

## Ce que ça donne

```console
$ mure status
swarm   validation
goal    Add input validation to parser and api handlers
verify  npm test
board   8 post(s)   max-parallel 2

MEMBER            ROLE        STATE                              LAST
@coordinator      coordinator you (2 unread)                     #4 note
@parser           worker      waiting (last verdict: validated)   #2 report
@api              worker      runnable (2 unread)                 #7 report
@verifier         verifier    waiting                            #8 verdict
```

Chaque post est numéroté, daté, adressé. Un membre sans post non lu ne tourne pas : il ne coûte rien,
puisqu'on ne le lance pas. C'est toute l'astuce — pas de polling, pas de processus endormi.

## Installation

Le dépôt **est** le skill : le dossier doit être visible sous le nom `mure`, avec `SKILL.md` à sa
racine.

```bash
git clone https://github.com/t12lve/mure.git
cd mure

# macOS / Linux
./install.sh

# Windows
.\install.ps1
```

Le script crée une jonction (Windows) ou un lien symbolique vers `~/.config/opencode/skills/mure`,
`~/.claude/skills/mure` et `~/.agents/skills/mure`, donc `git pull` met tout à jour d'un coup. Supprime
ce qui ne t'intéresse pas.

Prérequis : Node 18+ (`node scripts/mure.mjs help` doit afficher la liste des commandes). Git est
optionnel, sauf pour `mure scope`, `mure worktree` et la baseline de dispatch.

## Cinq minutes

```bash
cd mon-projet
M="node /chemin/vers/mure/scripts/mure.mjs"

# 1. l'essaim, avec la commande qui prouve le travail
$M init validation --goal "Add input validation to parser and api" --verify "npm test" --max-parallel 2 --worktrees

# 2. le découpage : un membre par morceau qui ne se chevauche pas
$M member add "@parser" --role worker --owns "src/parser.js,test/parser.test.js" --must-not "src/api.js" \
  --done "parse() throws on an empty segment"
$M member add "@api" --role worker --owns "src/api.js,test/api.test.js" --must-not "src/parser.js" \
  --done "handler returns 400 on invalid query"
$M member add "@verifier" --role verifier --watches "@parser,@api" --done "suite run, both diffs read, one verdict each"

# 3. le brief va aux workers, pas au vérificateur
$M post --from "@coordinator" --to "@parser,@api" --kind brief \
  --body "One file pair each. Report when npm test passes, ask before changing a shared signature."

# 4. qui a du travail ?
$M runnable
$M prompt "@parser"     # à donner tel quel à un seul sous-agent
```

Puis, quand les rapports sont là :

```bash
$M post --from "@coordinator" --to "@verifier" --kind note --body "Reports #2 and #3 are in. Run the tests, read both diffs, one verdict per worker."
$M prompt "@verifier"
$M verdict "@api" --verdict rejected --motif "No test asserts the 400 path."
$M close --summary "..."
```

`close` refuse tant qu'une question est ouverte, qu'un worker n'a jamais rapporté, qu'un worker a
rapporté sans être jugé, qu'un verdict est `rejected`, ou qu'un blocage n'est pas résolu. C'est voulu.

## Structure

```
SKILL.md               la méthode, lue par l'agent (anglais, portable)
README.md              version anglaise (la principale)
CHANGELOG.md           ce qui a changé, et les limites connues
CONTRIBUTING.md        « une règle non refusée par le code n'existe pas »
LICENSE                MIT
docs/
  DESIGN.md            pourquoi c'est construit ainsi (français)
  PROTOCOL.md          spécification normative : posts, états, portes
  ADAPTERS.md          comment lancer les membres dans chaque harnais
  EXAMPLES.md          quatre essaims complets, transcriptions réelles
scripts/mure.mjs       le CLI, zéro dépendance, Node 18+
test/mure.test.mjs     node --test, 23 tests
references/prompts.md  gabarits de prompts à copier
install.ps1 / install.sh
.github/workflows/     CI : Linux, macOS, Windows ; Node 18 à 22
```

L'état vit dans `.mure/<slug>/` à la racine du projet : `board.jsonl` (append-only), `members.json`,
`cursors.json`, `state.json`, `briefs/`, `worktrees/`. Ajoute `.mure/` à `.gitignore`.

## Les cinq commandes qui comptent

Dans toute cette doc, `mure` est le raccourci de `node <chemin>/scripts/mure.mjs`. Un alias de shell est
commode, jamais obligatoire.

| Commande | Question à laquelle elle répond |
|---|---|
| `mure runnable` | qui a du travail maintenant ? |
| `mure prompt @x` | que faut-il donner à `@x` pour son tour ? |
| `mure inbox @x` | qu'a lu `@x`, et qu'est-ce qui reste ? |
| `mure status` | où en est l'essaim ? |
| `mure close` | peut-on considérer que c'est fini ? |

## Ce qui est vérifié, et ce qui ne l'est pas

Testé réellement, sur Windows, Node 22 : création d'essaim, membres, posts, curseurs, prompt, scope
avec baseline, worktrees, verdicts, graphe mermaid, `doctor`, porte de clôture. Un essaim réel de deux
workers et un vérificateur a tourné en subagents OpenCode et produit un tableau complet. 23 tests
automatisés (`node --test test`), chacun vérifié par mutation : inverser la garde qu'il protège fait
tomber exactement le test correspondant. CI sur Linux, macOS et Windows, Node 18 à 22.

La relecture qui a suivi le premier essai a trouvé quatre défauts réels, tous corrigés et couverts : les
rôles n'étaient pas appliqués (un worker pouvait clore l'essaim ou poster un verdict), `@all` adressait
les membres tués, un nom de membre avec une espace cassait le graphe, et un `block` rendait la clôture
impossible pour toujours.

Limites connues, écrites dans `PROTOCOL.md` plutôt que cachées :

- en arbre partagé, `mure scope` ne peut pas attribuer les fichiers entre deux workers concurrents
  (utilise `--worktrees`, ou dispatche un worker à la fois) ;
- `prompt` avance le curseur : si le prompt est perdu entre l'affichage et la livraison, il faut
  `mure cursor @x --reset` ;
- la fusion des branches `mure/<slug>/<membre>` est laissée au coordinateur ;
- le protocole ne sait pas distinguer un tour perdu d'un tour jamais lancé.

## Licence

MIT.
