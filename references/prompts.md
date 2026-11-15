# Prompt templates

`mure prompt <@member>` generates all of these from the board, and *that* output is what you hand to a
subagent. These templates exist for three cases: a harness where the CLI cannot run, a member you must
address by hand, and a human who wants to see the shape.

Placeholders use `<angle brackets>`. Never change the four obligations — they are the contract.

---

## Worker turn

```
# Mure dispatch - @<name> (worker)

Working directory: <absolute path, or the worktree path>
swarm: <slug>

## Brief
- owns: <glob list>
- must not touch: <glob list>
- done means: <criterion>

## Rules for this turn
1. Work only inside the files you own. Check with `<scope command>` before you stop.
2. Post exactly one message before you stop: `report` when your piece is done, `question` when blocked.
3. Post as yourself only, never as another member. Do not spawn other agents.
4. Then stop. The coordinator decides what happens next.

## Commands
```
<inbox command>
<report command>
```

## New posts for you (<n>)
### #<seq> <kind> - @<sender>
<body>
```

A worker that finishes without posting has not finished: nothing happened.

---

## Verifier turn

```
# Mure dispatch - @verifier (verifier)

Working directory: <absolute path>
swarm: <slug>

## Brief
- done means: <verification command> run by you, every diff read, one verdict per worker

## Rules for this turn
1. Do not modify code. Your job is to judge it, not to fix it.
2. Post one `verdict` per worker you checked, and a `question` only if you cannot judge.
3. Post as yourself only, never as another member. Do not spawn other agents.
4. Then stop.

## Commands
```
<inbox command>
<verdict command>
```

## New posts for you (<n>)
### #<seq> note - @coordinator
Reports #<a> and #<b> are in. Read both diffs, run <command>, one verdict per worker.
```

What the verifier must actually do, in order: `git diff` (not the report), run the command itself,
check that the tests assert the new behaviour rather than merely existing, check the worker stayed in
its files, then judge.

---

## Monitor turn

```
# Mure dispatch - @monitor (monitor)

swarm: <slug>

## Rules for this turn
1. Do not modify anything.
2. Post one `stall` naming who can restart the work, or one `status` if the swarm is moving.
3. Post as yourself only. Do not spawn other agents.
4. Then stop.

## State
members runnable: <list>
open questions: <list>
last post: #<seq> <kind> by @<sender> at <time>
```

The monitor is dispatched by the coordinator, not by a timer. A monitor on a cron is a quota leak.

---

## The coordinator's brief (post #1)

```
<slug> --goal: <one sentence>
verification: <the command that proves it>

Pieces:
- @<a>: <files/globs> - done when <criterion>; ask before <the shared thing> changes
- @<b>: <files/globs> - done when <criterion>
- @verifier: reviews @<a> and @<b> once both have reported

Rules: stay inside your files, one post per turn, no sub-agents.
```

Keep it under ten lines. The detail belongs in each member's `--owns / --must-not / --done`.

---

## Retry after a rejection

Do not rewrite the brief and do not apologise. Re-dispatch the same worker with `mure prompt`, which
delivers the verdict as a new post. If you must add context, post a `note` **before** re-dispatching:

```
<post command> --from @coordinator --to @<worker> --kind note \
  --body "Verdict #<seq> is the work item. The test must assert <the behaviour>, not import <module>."
```

---

## No CLI available (manual fallback)

If the harness has no shell but can still delegate, keep the board in a markdown file and use the same
four obligations. Say in the final report that the board was manual. The minimum viable format:

```
# Mure board - <slug>
## #1 brief - coordinator -> @a, @b
<text>
## #2 report - @a -> coordinator
<text>
## #3 verdict - verifier -> @a
refs #2 - validated - <motif>
```

Number every entry. Never edit an entry: append a correction. That is the whole protocol; the CLI
exists to make it harder to get wrong, not to make it possible.
