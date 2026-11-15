# Mure 群れ

[![test](https://github.com/t12lve/mure/actions/workflows/test.yml/badge.svg)](https://github.com/t12lve/mure/actions/workflows/test.yml)

A flock of coding agents working on one blackboard: a coordinator splits the task, named workers build
in parallel, an independent verifier runs the tests and judges, and nothing counts as done until that
judge has spoken.

Mure is the `/swarm` idea from Google Antigravity, ported to harnesses whose agents cannot sleep on a
board — OpenCode, Claude Code, Codex CLI, Gemini CLI, Cursor. It is a **skill** (`SKILL.md`) plus a
**dependency-free CLI** (`scripts/mure.mjs`).

*[Français](README.fr.md)*

> The board is the only truth, a mention is the only wake signal, and the coordinator does not do the
> technical work.

## What it looks like

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

Every post is numbered, timestamped and addressed. A member with no unread post is not running: it
costs nothing, because you simply do not spawn it. That is the whole trick — no polling, no sleeping
processes.

## Install

The repository *is* the skill: the folder must be visible under the name `mure`, with `SKILL.md` at its
root.

```bash
git clone https://github.com/t12lve/mure.git
cd mure

# macOS / Linux
./install.sh

# Windows
.\install.ps1
```

The script links (junction on Windows, symlink elsewhere) into `~/.config/opencode/skills/mure`,
`~/.claude/skills/mure` and `~/.agents/skills/mure`, so `git pull` updates every harness at once.
Delete the ones you do not use.

Requirements: Node 18+ (`node scripts/mure.mjs help` should print the command list). Git is optional,
except for `mure scope`, `mure worktree` and the dispatch baseline.

## Five minutes

```bash
cd my-project
M="node /path/to/mure/scripts/mure.mjs"

# 1. the swarm, with the command that proves the work
$M init validation --goal "Add input validation to parser and api" --verify "npm test" --max-parallel 2 --worktrees

# 2. the cut: one member per non-overlapping piece
$M member add "@parser" --role worker --owns "src/parser.js,test/parser.test.js" --must-not "src/api.js" \
  --done "parse() throws on an empty segment"
$M member add "@api" --role worker --owns "src/api.js,test/api.test.js" --must-not "src/parser.js" \
  --done "handler returns 400 on invalid query"
$M member add "@verifier" --role verifier --watches "@parser,@api" --done "suite run, both diffs read, one verdict each"

# 3. the brief goes to the workers, not to the verifier
$M post --from "@coordinator" --to "@parser,@api" --kind brief \
  --body "One file pair each. Report when npm test passes, ask before changing a shared signature."

# 4. who has work?
$M runnable
$M prompt "@parser"     # hand this text, verbatim, to one subagent
```

Then, when the reports are in:

```bash
$M post --from "@coordinator" --to "@verifier" --kind note --body "Reports #2 and #3 are in. Run the tests, read both diffs, one verdict per worker."
$M prompt "@verifier"
$M verdict "@api" --verdict rejected --motif "No test asserts the 400 path."
$M close --summary "..."
```

`close` refuses while a question is open, a worker never reported, a worker reported without being
judged, a verdict is `rejected`, or a block is unresolved. That is the point.

## Structure

```
SKILL.md               the method, read by the agent (English, portable)
README.md              this file
CHANGELOG.md           what changed, and the known limits
CONTRIBUTING.md        "a protocol rule the code does not refuse does not exist"
LICENSE                MIT
docs/
  DESIGN.md            why it is built this way (French)
  PROTOCOL.md          normative spec: posts, states, gates
  ADAPTERS.md          how to spawn members in each harness
  EXAMPLES.md          four complete runs, real board transcripts
scripts/mure.mjs       the CLI, zero dependencies, Node 18+
test/mure.test.mjs     node --test, 23 tests
references/prompts.md  paste-ready prompt templates
install.ps1 / install.sh
.github/workflows/     CI: Linux, macOS, Windows; Node 18 to 22
```

State lives in `.mure/<slug>/` at the project root: `board.jsonl` (append-only), `members.json`,
`cursors.json`, `state.json`, `briefs/`, `worktrees/`. Add `.mure/` to `.gitignore`.

## The five commands that matter

`mure` below stands for `node <path>/scripts/mure.mjs`; a shell alias is convenient, never required.

| Command | The question it answers |
|---|---|
| `mure runnable` | who has work right now? |
| `mure prompt @x` | what must `@x` be given for its turn? |
| `mure inbox @x` | what has `@x` read, what is left? |
| `mure status` | where is the swarm? |
| `mure close` | may we call this finished? |

## Verified, and not

Tested for real on Windows with Node 22: swarm creation, members, posts, cursors, prompts, baseline
scope, worktrees, verdicts, the mermaid graph, `doctor`, the close gate. A real swarm of two workers
and one verifier ran as OpenCode subagents and produced a complete board. 23 automated tests
(`node --test test`), each checked by mutation: invert the guard it protects and exactly that test goes
red. CI runs on Linux, macOS and Windows with Node 18 to 22.

The review that followed the first live run found four real defects, all fixed and covered: roles were
not enforced (a worker could close the swarm or post a verdict), `@all` addressed killed members, a
member name with a space broke the graph, and one `block` made closing impossible forever.

Known limits, written down in `PROTOCOL.md` rather than hidden:

- in a shared working tree, `mure scope` cannot attribute files between two concurrent workers (use
  `--worktrees`, or dispatch one worker at a time);
- `prompt` advances the read cursor: a prompt lost between printing and delivery needs
  `mure cursor @x --reset`;
- merging the `mure/<slug>/<member>` branches is the coordinator's job, not the tool's;
- a lost turn is indistinguishable from a turn never dispatched.

## License

MIT.
