# Examples — three complete runs

Every transcript below is real output, trimmed only where marked `[...]`. Project paths are shortened
to `<repo>`.

---

## 1. Parallel implementation, with one rejection loop

**Goal:** add input validation to two files, prove it with `node --test`.
**Cut:** one worker per file, one verifier for both.

```bash
M="node <repo>/scripts/mure.mjs"
$M init validation --goal "Add input validation to parser and api handlers, then verify with tests" --max-parallel 2
$M member add "@parser" --role worker --owns "src/parser.js" --must-not "src/api.js" \
  --done "parse() rejects empty segments, node --test passes"
$M member add "@api" --role worker --owns "src/api.js" --must-not "src/parser.js" \
  --done "handler returns 400 on invalid query"
$M member add "@verifier" --role verifier --watches "@parser,@api" \
  --done "node --test runs, both diffs read, one verdict each"
$M post --from "@coordinator" --to "@parser,@api" --kind brief \
  --body "One file each. Report when done, ask before changing a shared signature."
```

Note the brief goes to the **two workers only**. The verifier is not woken by a brief: there is
nothing to verify yet. `mure` warns if you get this wrong.

### The board

```bash
$M board --markdown
```

```markdown
# validation

_Add input validation to parser and api handlers, then verify with tests_

## #1 brief - @coordinator -> @parser @api
One file each. Report when done, ask before changing a shared signature.

## #2 report - @parser -> @coordinator
parse() throws on empty segments. Export name unchanged.

## #3 report - @api -> @coordinator
handler returns 400 on invalid query. No test file (out of scope).

## #4 note - @coordinator -> @verifier
Reports #2 and #3 are in. Read both diffs, run node --test, one verdict per worker.

## #5 verdict - @verifier -> @api
refs #3  verdict rejected
No test asserts the 400 path; add src/api.test.js then re-report.

## #6 verdict - @verifier -> @parser
refs #2  verdict validated
Guard added, export name stable, behaviour matches the brief.

## #7 report - @api -> @verifier @coordinator
Added src/api.test.js asserting 400. node --test: 3 passed.

## #8 verdict - @verifier -> @api
refs #7  verdict validated
Test now asserts the 400 path; suite passes.

## #9 done - @coordinator -> @coordinator @parser @api @verifier
parser and api validate input; verifier ran the suite and read both diffs; api fixed one rejection
```

### What to notice

- **#5 is the point of the whole thing.** `@api` reported honestly ("no test file, out of scope") and
  the verifier rejected it against the brief's own `done` criterion. The coordinator did not have to
  notice; the gate did.
- **#7 arrives without a new brief.** The rejection is the work item; `mure prompt @api` delivers it.
- **#4 wakes the verifier and nothing else.** A `note`, not a `brief`.

### The close gate

Closing before #7 would have refused:

```
$ mure close --summary "too early"
mure: refusing to close, the swarm is not finished:
  - @api last verdict is rejected (#5)
fix them, or pass --force to close anyway (the final report must then say what is unresolved)
```

---

## 2. Two writers in the same working tree: the failure that shaped the design

**Goal:** two workers editing two files, dispatched at the same time, in a shared tree (no worktrees).
**What happened:** both wrote correctly; both scope checks blamed them for the other's files.

```
@api in <repo>
changed: src/parser.js, src/api.js
VIOLATION src/parser.js (must-not-touch)
```

Two independent workers reported the same false accusation in their reports:

> `mure scope @limit` reports VIOLATION on `src/parser.js` and `test/` because the worktree is shared
> with @parser; I did not edit those files (mtime shows they were written by @parser at 12:34:14).

That is the correct behaviour from them — and a real defect in the tool, because a scope check that
cries wolf is worse than no check. Three things changed:

1. `mure prompt` now records a **baseline** of the working tree at dispatch
   (`git stash create` + untracked list) and `scope` only judges what changed since;
2. `prompt` warns the coordinator when another worker is runnable in the same tree;
3. `init --worktrees` gives each worker its own copy from `member add` onwards.

### The same run, with worktrees

```bash
$M init wt --goal "test worktrees" --worktrees
$M member add "@wa" --role worker --owns "src/a.js" --done "a works"
#   added @wa (worker)
#   worktree: <repo>/.mure/wt/worktrees/wa
$M member add "@wb" --role worker --owns "src/b.js" --done "b works"
#   worktree: <repo>/.mure/wt/worktrees/wb

$M post --from "@coordinator" --to "@wa,@wb" --kind brief --body "one file each"
$M prompt "@wa" > /dev/null      # baseline recorded
$M prompt "@wb" > /dev/null
```

Each worker edits its own copy:

```
@wa in <repo>/.mure/wt/worktrees/wa
changes since dispatch 2026-11-15T11:36:16Z: src/a.js
scope: clean

@wb in <repo>/.mure/wt/worktrees/wb
changes since dispatch 2026-11-15T11:36:16Z: src/b.js
scope: clean
```

And a real violation is still caught:

```
@wa in <repo>/.mure/wt/worktrees/wa
changes since dispatch 2026-11-15T11:36:16Z: src/a.js, src/b.js
VIOLATION src/b.js (outside owns)
exit=3
```

**Rule that follows:** worktrees when two workers can write at once; a shared tree only for a single
writer or a read-only investigation.

---

## 3. A read-only investigation

**Goal:** find why a CLI takes four seconds to start, without touching code.
**Cut:** three investigators, one question each, one synthesizer.

```bash
$M init startup --goal "Explain the 4s CLI startup, ranked fixes, no code changes" --max-parallel 3
$M member add "@imports" --role worker --done "list the module-load cost, with numbers"
$M member add "@config"  --role worker --done "time config loading, name the slow path"
$M member add "@plugins" --role worker --done "time plugin discovery, list what is loaded"
$M member add "@synth"   --role monitor --done "one ranked list, each claim tied to a post number"
$M post --from "@coordinator" --to "@imports,@config,@plugins" --kind brief \
  --body "Read-only. Post a report with numbers and the command you used. No file may change: run mure scope before you stop and post the empty result."
```

All three workers have empty `--owns`, so any edit is a violation by construction — the cheapest
read-only guard there is.

```
$M runnable
3 runnable member(s):
  @imports           worker       unread #1
  @config            worker       unread #1
  @plugins           worker       unread #1
```

Once the three reports are in, the coordinator posts a `note` to `@synth` with the three report
numbers and the synthesis constraint: *every claim cites a post number, and a claim no post supports is
dropped*. `@synth` is declared `monitor` rather than `worker` because it must not write code; the role
only changes the rules line in its prompt.

**Why not a verifier here?** There is nothing executable to verify. The verification of a research
claim is the citation, and the coordinator checks it by opening the cited posts. Saying that out loud
in the final report is part of the method: `validated` is for facts a command can prove.

---

## 4. A real swarm, end to end (OpenCode subagents)

The same shape as example 1, but with **real subagents** doing the turns instead of a simulation, in a
shared working tree, on purpose, to see where it breaks.

```bash
$M init valid --goal "Add input validation to parse() and limit(), with tests, verified by an independent agent" --max-parallel 2
$M member add "@parser" --role worker --owns "src/parser.js,test/parser.test.js" --must-not "src/limit.js,test/limit.test.js" --done "parse() throws on an empty segment; test/parser.test.js covers it; npm test passes"
$M member add "@limit"  --role worker --owns "src/limit.js,test/limit.test.js"   --must-not "src/parser.js,test/parser.test.js" --done "limit() rejects negatives and caps at 100; test/limit.test.js covers it; npm test passes"
$M member add "@verifier" --role verifier --watches "@parser,@limit" --done "npm test run, both diffs read, one verdict per worker"
$M post --from "@coordinator" --to "@parser,@limit" --kind brief --body "One file pair each: your source file and your test file. Do not touch the other worker's files. Post a report when npm test passes for your part, a question if the shared contract must change."
```

`mure prompt @parser` and `mure prompt @limit` were each handed to one subagent, verbatim, in parallel.
Both came back with a report and one unresolved complaint:

> `mure scope @limit` still flags VIOLATION on `src/parser.js` and `test/` — a shared-worktree artifact
> from @parser's concurrent edits, not mine (…). npm test 15/15 passes.

Then the verifier was woken by a note and produced this, unprompted beyond its brief:

> **@limit — validated.** … 6 tests assert pass-through, cap at 100, RangeError for -1 and -1000,
> TypeError for non-number, non-finite and non-integer input. **Mutation check on a temp copy** (original
> limit body, MAX_LIMIT and MIN_LIMIT kept): 4 of the 6 limit tests fail, so they discriminate. … Minor
> gap: no test for -0, and the TypeError message text is unasserted.
>
> **@parser — validated.** … **Mutation check** on a temp copy with the original `q.split` body: 5 of 9
> fail, including all empty-segment cases, so the done-means claim is proven. Caveat: the non-string
> TypeError test also passes against the old code because `42.split` throws … Report #3 is truncated on
> the board mid-sentence after a backslash; **the diff, not the report, is the evidence.**

`mure close` then succeeded on the first attempt, and `doctor` reported a clean board.

### What only a real run tells you

- **The verifier is worth its cost.** It mutation-tested on a throwaway copy — a check nobody asked for
  — and it downgraded its own confidence instead of rubber-stamping. That is the behaviour the gate is
  supposed to buy.
- **A worker will report a tool defect instead of hiding it.** Both did, which is a good sign for the
  worker, and a bug report for Mure: fixed by the baseline described in example 2.
- **A truncated post is indistinguishable from a dishonest one** unless the verifier reads the diff.
  Post bodies with quotes or backslashes via `--body-file`, never inline.
- **`mure status` stayed readable throughout.** Nine lines told the coordinator everything it needed
  between turns, with no conversation to re-read.

---

## 5. Sizing cheat sheet

| Task | Members | max-parallel | Worktrees |
|---|---|---|---|
| 2–3 files, one behaviour | 2 workers + 1 verifier | 2 | no (dispatch one at a time) or yes |
| 5–8 files, one module | 4 workers + 2 verifiers | 4 | yes |
| Whole-repo test repair | one worker per broken package + 1 verifier per 2–4 | 4 | yes |
| Read-only investigation | 3 investigators + 1 synthesizer | 3 | no |
| Anything above ~8 workers | split into successive swarms, one per milestone | 4 | yes |

Past eight concurrent members the coordinator spends more tokens routing than the workers spend
working. That is the quota cliff, and it is why `max-parallel` defaults to 4.
