---
name: mure
description: Use when a task is broad but divides cleanly across independent files, packages, test suites or questions, and one agent would be slow or would drown its own context doing it all: parallel implementation across files, multi-package test repair, codebase-wide investigation, or an independent agent that must review and test changes before they land. Also use when the user says swarm, mure, essaim, agent team, or asks for named parallel subagents coordinating on a shared board.
license: MIT
metadata:
  version: 0.1.0
  requires: node >= 18, git (optional, for worktrees)
---

# Mure

Mure (群れ) is a flock: a coordinator, named workers, a verifier, and one append-only board
they all talk on. It is the discipline that makes several agents cheaper than one, written down
so it survives contact with a real task.

Read `docs/PROTOCOL.md` when you need the normative rules. Read `docs/ADAPTERS.md` for how to
spawn members in this harness. Everything below is the working method.

## Core principle

**The board is the only truth, mentions are the only wake signal, and the coordinator does not do
the technical work.** Every assignment, question, report and verdict is a numbered post. A member
acts only when it has a new post addressed to it; a member with nothing addressed to it is idle and
costs nothing, because you simply do not spawn it.

That last sentence is the whole trick. Antigravity can park an agent asleep on a board; here,
"asleep" means "no process running". Do not simulate sleeping agents with polling loops.

## When to use it

| Situation | Use |
|---|---|
| One focused side task while you keep working | a single subagent |
| A hard, tightly coupled problem (one bug, one algorithm) | one agent, or `/boost`-style retries |
| **Broad work that splits into non-overlapping pieces** | **Mure** |
| Work spanning hours or days with milestones | a plan + sequential Mure runs, not one giant swarm |

Do not use Mure for: a one-file change, a question you can answer yourself, work where every piece
touches the same file, or anything you cannot state a verification command for.

## The loop

Run these seven steps in order. Do not skip step 1 or step 6.

The CLI lives **with the skill**, not in the user's project: `node <skill dir>/scripts/mure.mjs`, or a
shell alias. Every command below writes its state into the current repository's `.mure/`, so run it
from the project you are working on.

### 1. State the goal and the verification

Before creating anything, write down the goal in one sentence and the command that proves it
(`npm test`, `pytest -q`, `go test ./...`, `tsc --noEmit`). A swarm without a verification command
produces confident prose, not working code.

### 2. Create the swarm

```bash
node scripts/mure.mjs init <slug> --goal "<one sentence>" --verify "npm test" --max-parallel 4 --worktrees
```

`--verify` is the command that proves the work; it is written into the swarm and appears in every
member's prompt, so nobody has to guess what "done" means. `--max-parallel` is your quota brake, not a
technical limit. Default 4. `--worktrees` gives every worker added afterwards its own git working copy,
which makes scope checks exact; without it, workers share your tree and their edits are
indistinguishable (see "Worktrees" below).

### 3. Cut the work into pieces that cannot collide

One piece per file, per package, per module, or per question. Name each member after its piece:
`@parser`, `@api-tests`, `@docs`. For a pool of similar pieces use a numbered group: `@fix-1` …
`@fix-4`.

```bash
node scripts/mure.mjs member add "@parser" --role worker \
  --owns "src/parser.js,test/parser.test.js" \
  --must-not "src/api.js" \
  --done "parse() throws on an empty segment; npm test passes"
node scripts/mure.mjs member add "@verifier" --role verifier \
  --watches "@parser,@api" --done "suite run, both diffs read, one verdict per worker"
```

`--owns` is a glob list and it is enforced: `mure scope @parser` compares the files changed since the
member's dispatch against it, and exits non-zero on a violation. A worker that owns nothing cannot be
checked.

### 4. Post the brief, then dispatch

```bash
node scripts/mure.mjs post --from "@coordinator" --to "@parser,@api" --kind brief \
  --body "One file pair each. Report when npm test passes, ask before changing a shared signature."
node scripts/mure.mjs runnable
```

For each runnable member, get its turn prompt and hand it to a subagent **verbatim**:

```bash
node scripts/mure.mjs prompt "@parser"      # prints the dispatch, advances that member's cursor
```

`prompt` renders the member's brief plus every post it has not read, and advances its read cursor:
the text you paste *is* the delivery. Do not paraphrase it, do not summarize the board into it, and
do not paste the same prompt into two agents.

Dispatch in parallel when the pieces are independent. Respect `max-parallel`.

### 5. Collect and route

Each worker's turn ends with exactly one post: `report`, or `question` if blocked. Then the process
stops. When a `question` lands:

```bash
node scripts/mure.mjs answer <seq> --from "@coordinator" --body "..."
```

When the reports are in, wake the verifier with a `note` — **never** a `brief`, which would wake it
before there is anything to verify:

```bash
node scripts/mure.mjs post --from "@coordinator" --to "@verifier" --kind note \
  --body "Reports #2 and #3 are in. Read both diffs, run npm test, one verdict per worker."
```

### 6. Verify before you believe

The verifier reads the diffs, runs the real command, and posts one verdict per worker:

```bash
node scripts/mure.mjs verdict "@api" --verdict rejected \
  --motif "No test asserts the 400 path; add src/api.test.js then re-report."
node scripts/mure.mjs verdict "@parser" --verdict validated-with-reserve \
  --motif "Behaviour and export name match the brief." \
  --reserve "no test for the whitespace-only segment case"
```

| Verdict | Meaning | Effect |
|---|---|---|
| `validated` | checked, matches the brief | done |
| `validated-with-reserve` | checked, with a named gap | done; the reserve text must be quoted verbatim wherever the result is reported or committed |
| `rejected` | does not meet the brief | the worker is re-dispatched |
| `needs-info` | cannot be judged yet | the coordinator posts the missing fact |

A verdict must cite a report (`--on <seq>`; it defaults to the worker's latest report). A rejection
is not a scolding, it is a work item: re-dispatch the same worker with `prompt`.

### 7. Close and report

```bash
node scripts/mure.mjs close --summary "..."
```

`close` refuses while a question is unanswered, a worker never reported, a worker reported but no
verdict was posted (when the swarm has a verifier), a last verdict is `rejected`/`needs-info`, or an
unresolved `block`/`stall` is on the board. Clear the last with `mure resolve <seq>`; `--force` exists,
but using it means your final report must name what is unresolved.

Then report to the human in this shape: **what was verified** (and by which command), **what was
not**, **contradictions**, **where the files landed**, and **what a reserve means**. Never present a
`validated-with-reserve` result as clean.

## The dispatch contract

A member turn is: *read your new posts → work only inside your scope → post exactly one message →
stop.*

`mure prompt` enforces the shape. The four obligations it prints are the contract:

1. Work only inside the files you own; `mure scope @you` before stopping.
2. Post exactly one message: `report`, or `question` when blocked.
3. Post as yourself only, never as another member, never spawn other agents.
4. Then stop. The coordinator decides what happens next.

If a subagent returns without posting, the turn did not happen: nothing on the board. Re-dispatch it,
or post its result yourself as `@coordinator` with `--kind note` and say so.

## Roles

| Role | Writes | Must not |
|---|---|---|
| `coordinator` | briefs, notes, answers, done | edit product code, review its own work |
| `worker` | reports, questions | touch another worker's files, post verdicts |
| `verifier` | verdicts, questions | fix the code itself, rewrite the brief |
| `monitor` | `stall`, `status` | act while the swarm is moving |

These are enforced, not requested: `mure post` refuses a kind your role may not write, and
`mure verdict` refuses a non-verifier. Names must match `[A-Za-z][A-Za-z0-9._-]{0,31}`; slugs must be
lowercase and hyphenated.

The monitor is optional and cheap: add one only for runs long enough to get stuck silently. It stays
off until every member is waiting and the swarm is not closed, then posts `stall` naming who can
restart the work.

## Command reference

`mure` below stands for `node scripts/mure.mjs` (add a shell alias if you like; nothing requires one).

```bash
mure init <slug> --goal "..." [--max-parallel N] [--worktrees]
mure member add <@name> --role worker|verifier|monitor [--owns globs] [--must-not globs] [--done text] [--watches @a,@b] [--model id]
mure member kill <@name> [--reason "..."] [--force]
mure post --from @n --to @a,@b|@all --kind brief|report|question|answer|claim|verdict|status|stall|note|done|block [--body "..."] [--body-file f] [--stdin] [--ref N]
mure answer <seq> --from @n --body "..."
mure resolve <seq> [--from @n] [--body "..."]
mure inbox <@n> [--peek] [--json]
mure prompt <@n> [--no-advance] [--force]
mure verdict <@w> --verdict validated|validated-with-reserve|rejected|needs-info --motif "..." [--reserve "..."] [--on N]
mure scope <@n> [--json]
mure worktree <@n> --create|--remove [--force]
mure runnable | status | open | board [--tail N] [--all] [--markdown] | graph | doctor
mure close [--summary "..."] [--force] | reopen
```

Global flags: `--root <dir>`, `--swarm <slug>`. `mure help` prints the same list.
Exit codes: `0` ok, `1` refused or invalid (including "nothing to dispatch"), `3` scope violation.

`mure prompt` refuses a member with no unread post: a dispatch that delivers nothing is an error, not
a wake-up call. `--force` prints the prompt anyway, for inspection.

Long or quote-heavy bodies (`"`, `\`, newlines) get mangled by shells. Write them to a file and use
`--body-file <path>`, or pipe them with `--stdin`. A truncated report is a real failure: the first
live run lost half of a report to PowerShell quoting, and the verifier had to judge on the diff alone.

## Worktrees, when pieces collide

Workers share your workspace by default. When several of them edit or build at the same time, give
each its own copy — either at creation (`init --worktrees`) or one at a time:

```bash
mure worktree "@parser" --create     # .mure/<slug>/worktrees/parser, branch mure/<slug>/parser
mure worktree "@parser" --remove     # refuses if uncommitted work; --force discards it
```

Two things follow from a shared tree, and both are traps:

- **Attribution is impossible.** Two workers editing the same tree produce one mixed `git status`, so
  `mure scope @a` blames `@a` for `@b`'s files. `prompt` warns you when this happens. Dispatch one
  worker at a time, or use worktrees.
- **Baselines still help.** `mure prompt` records a snapshot of the tree at dispatch, and `scope`
  reports only what changed since. That keeps a single-worker turn honest; it does not separate two
  concurrent workers.

A removed worker loses its working copy, so land or commit its work first. Removal is permanent:
`member kill` cannot be undone, you add a new member instead.

## Quota discipline

Every dispatched member is a full agent. Three rules keep the cost sane:

- `max-parallel` is a hard budget per round. At 4, four workers is fine; twelve is a mistake.
- Never dispatch a member that `runnable` does not list. "Just to check in" is a full agent.
- Prefer re-dispatching one worker over adding a second one to the same piece.

## Red flags

| Thought | Reality |
|---|---|
| "I'll just implement this one piece myself, faster" | Then it is not a swarm. Either cut it honestly or do the whole task alone. |
| "I'll summarize the board into the prompt to save tokens" | The prompt is the delivery. Paraphrasing loses posts and inventing facts is worse. |
| "The workers are done, I'll skip the verifier" | Unverified work is a draft. Say "not verified" out loud or run the gate. |
| "The verifier rejected it, but it's basically fine" | Re-dispatch. A coordinator that overrules its verifier is reviewing its own work. |
| "I'll poll `status` until someone moves" | Nobody moves on their own. `status` tells you *who to dispatch*, not what will happen next. |
| "One more worker will speed this up" | Only if its files do not overlap. Two agents on one file means one diff to throw away. |
| "The reserve is minor, I'll drop it from the report" | The reserve is the honest part of the result. Quote it verbatim. |
| "`close` refuses, so I'll `--force`" | Then you owe the human the list of what is unresolved. |

## Files

```
SKILL.md              this file
scripts/mure.mjs      the CLI (zero dependencies, Node 18+)
docs/PROTOCOL.md      normative spec: record schema, states, gates
docs/ADAPTERS.md      how to spawn members in OpenCode, Claude Code, Codex, Gemini CLI, Cursor
docs/EXAMPLES.md      four complete runs with real board transcripts
docs/DESIGN.md        why it is built this way (French)
references/prompts.md paste-ready templates for worker, verifier, monitor turns
```

State lives in `.mure/<slug>/` at the repository root: `board.jsonl` (append-only),
`members.json`, `cursors.json`, `briefs/`, `worktrees/`. Add `.mure/` to `.gitignore`.
