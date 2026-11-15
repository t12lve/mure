# Mure protocol — normative specification

Version 0.1.0. This document defines what a conforming implementation must do. `scripts/mure.mjs`
is the reference implementation; where it and this document disagree, the document wins and the
script is a bug.

## 1. Scope

Mure coordinates several agents on one task through a single append-only log. It defines:

- the shape of a post and the vocabulary of posts,
- who may post what,
- how a member learns that it has work (the wake rule),
- when a result may be considered verified,
- when a swarm may be closed.

It does not define how agents are spawned, which model they use, or how files are merged. Those are
harness concerns, described in `ADAPTERS.md`.

## 2. Terms

| Term | Definition |
|---|---|
| swarm | one coordination session, identified by a slug, living in `.mure/<slug>/` |
| board | the append-only JSONL log of a swarm |
| post | one line of the board, with a monotone `seq` |
| member | a named participant: `coordinator`, `worker`, `verifier`, `monitor` |
| brief | the public statement of a member's scope, posted once as a `brief` post |
| turn | one dispatch of one member: read, work, post exactly once, stop |
| dispatch | the act of starting a turn for a member, by handing it `mure prompt <@member>` |
| wake | a member becoming runnable because a post addressed to it was appended |
| verdict | a verifier's judgement of a worker's report |
| close | the terminal event of a swarm |

## 3. Invariants

A conforming implementation MUST hold all of them.

1. **Append-only.** A post is never edited or deleted. Corrections are new posts.
2. **Monotone sequence.** `seq` starts at 1 and increases by exactly 1.
3. **Mentions are the only wake signal.** A member is runnable if and only if the board holds a post
   with `seq` greater than its read cursor and its name in `to`. Nothing else wakes a member: not a
   file change, not elapsed time, not another member's silent completion.
4. **One post per turn, from the acting member.** A member posts as itself only. It never posts as
   another member and never spawns another member.
5. **The coordinator does not do the technical work.** It posts briefs, notes, answers, and the
   closing `done`. Product code is written by workers.
6. **A worker stays inside its scope.** `owns` and `must-not` are declared before the first
   dispatch, and violations are detectable from the working tree.
7. **No result is verified without the verification command having run.** The verifier runs it; the
   coordinator may not accept a report on the worker's word alone.
8. **A closed swarm accepts no new post.** Only `reopen` clears the flag.

## 4. Layout

```
<root>/.mure/
  <slug>/
    meta.json        { mure, slug, goal, verify, created, closed, maxParallel, worktrees }
    members.json     { members: { <name>: Member } }
    board.jsonl      append-only log, one JSON object per line
    cursors.json     { <name>: <seq> }   last seq delivered to that member
    briefs/<name>.md human-readable copy of the brief
    worktrees/<name>/  optional per-worker git worktree
```

`meta.json`, `members.json`, `cursors.json` are derived state and may be rebuilt from the board plus
`members.json`; the board is the only irreplaceable file. Nothing outside `.mure/` belongs to Mure.

## 5. Post

```json
{
  "seq": 7,
  "ts": "2026-11-15T11:33:07Z",
  "from": "@api",
  "to": ["@verifier", "@coordinator"],
  "kind": "report",
  "body": "handler returns 400 on invalid query. No test file (out of scope).",
  "refs": [3],
  "meta": {}
}
```

- `seq` integer, unique, monotone, assigned by the log.
- `ts` ISO-8601 UTC, second precision.
- `from` a member name, stored with `@`.
- `to` non-empty array of member names. `@all` and `@prefix*` are **expanded at write time**; the
  record never contains a wildcard, so the log stays readable years later.
- `kind` one of the vocabulary below.
- `body` non-empty except for `status`.
- `refs` array of earlier `seq` values this post answers or judges. Forward or unknown refs are
  forbidden.
- `meta` free object; `verdict` and `reserve` are reserved keys.

### Kinds

| Kind | Posted by | Purpose |
|---|---|---|
| `brief` | coordinator | declares a member's scope and done criterion |
| `report` | worker | "my piece is done, here is what I changed and what I ran" |
| `question` | any | blocked, needs a decision; must have a recipient other than the sender |
| `answer` | any | answers a `question`; MUST carry `refs: [<question seq>]` |
| `claim` | worker | announces a piece before working on it, to avoid duplicate effort |
| `verdict` | verifier | judges a report; `meta.verdict` is required |
| `status` | anyone | state change or progress note, no action implied |
| `stall` | monitor | the swarm stopped moving while work remained |
| `note` | coordinator | instruction or context, no verdict, no scope change |
| `done` | coordinator | closes the swarm |
| `block` | any | something outside the swarm forbids progress |

Unknown kinds are a protocol error; `doctor` reports them.

**Role matrix (enforced).** A post whose kind is not allowed for the sender's role is refused with
exit 1. The protocol is not advisory:

| Role | May post |
|---|---|
| `coordinator` | `brief`, `report`, `note`, `answer`, `done`, `status`, `question`, `block` |
| `worker` | `report`, `question`, `claim`, `answer`, `note`, `status`, `block` |
| `verifier` | `verdict`, `question`, `answer`, `note`, `status`, `block` |
| `monitor` | `stall`, `question`, `answer`, `note`, `status`, `block` |

A coordinator may post a `report` only to relay a worker whose turn was lost; it must say so in the
body. That the role matrix exists is not enough: it must reject, and it does (see the audit in
`DESIGN.md`).

**Names.** Member names match `[A-Za-z][A-Za-z0-9._-]{0,31}`, swarm slugs match
`[a-z0-9][a-z0-9-]{0,39}`. This keeps file paths, shell arguments and mermaid graph ids safe. Names are
case-sensitive.

**Quoting.** A body containing quotes, backslashes or newlines must be written with `--body-file` or
piped with `--stdin`. Shell quoting is not a protocol concern, but a truncated body destroys evidence:
the first live run lost half a report to PowerShell argument parsing, and the verdict had to rest on
the diff alone.

## 6. Read cursor and the wake rule

Each member has a cursor: the highest `seq` delivered to it. `unread(m) = posts where seq > cursor(m)
and m ∈ to`.

- `mure inbox <@m>` prints the unread posts and advances the cursor to the highest printed `seq`.
  `--peek` prints without advancing.
- `mure prompt <@m>` prints the turn prompt containing the same unread posts and advances the cursor
  by default. The printed text is the delivery: if the harness fails to deliver it, nothing was
  delivered, and `mure cursor <@m> --reset` (or `--set N`) is the recovery.
- `--no-advance` previews a prompt without delivering it.
- A prompt with zero unread posts is **refused** (exit 1): a dispatch that delivers nothing is a
  coordinator error, not a wake-up. `--force` prints it anyway, for inspection.
- `mure runnable` lists members with unread posts. It is the only legitimate source of dispatch
  decisions.

Consequence, and it is deliberate: **idle costs nothing**. A member with no unread post is not
running, not polling, not parked. It simply does not exist as a process until the next post mentions
it.

`mure runnable` reports the coordinator's own unread count separately, because the coordinator is the
agent reading the command output, not a member to spawn.

## 7. Member states

| State | Meaning | Entered when |
|---|---|---|
| `active` | a turn is running | the coordinator dispatches it |
| `waiting` | no unread post, no process | its last delivered post was processed |
| `runnable` | has unread posts, not yet dispatched | a post addressed to it is appended |
| `paused` | quota or budget exhausted | the harness refuses the turn |
| `killed` | removed permanently | `member kill` |

`runnable`, `waiting` and `paused` are behavioural states; only `killed` and the member record are
persisted. A killed member cannot be revived: add a new member with a new name. It also cannot be
dispatched — `mure prompt` refuses it — and `@all` no longer addresses it.

## 8. Dispatch contract

A turn is a prompt with four obligations:

1. work only inside the files you own; run `mure scope <@you>` before stopping;
2. post exactly one message: `report` when the piece is done, `question` when blocked;
3. post as yourself only, never spawn another member;
4. stop after posting.

The prompt is composed of: the brief (`owns`, `must not touch`, `done means`, the swarm's
`verification command`, worktree path), the four obligations, the two or three exact commands the
member needs, and the unread posts rendered in full with their numbers.

Rules for the coordinator:

- hand the prompt over **verbatim**; no summarizing, no reordering, no "in short";
- one prompt, one member: the same text must not be pasted into two agents, because it would advance
  both cursors past posts only one of them processed;
- dispatch in parallel only pieces that cannot collide;
- never dispatch more than `maxParallel` members in one round.

If a dispatched member returns without posting, the turn did not happen. Re-dispatch it, or post its
result yourself as `@coordinator` with `--kind note` and state that you did.

## 9. Verification gate

A `verdict` MUST:

- come from a member with role `verifier`;
- cite the report it judges (`refs`), defaulting to that worker's latest `report`;
- carry `meta.verdict` ∈ `validated`, `validated-with-reserve`, `rejected`, `needs-info`;
- carry a non-empty `motif`;
- carry `meta.reserve` when the verdict is `validated-with-reserve`, and that text is quoted
  verbatim in every place the result is later reported or committed.

If the swarm has exactly one verifier, `--from` may be omitted; with several, the author must be named.

Effects:

| Verdict | Worker | Swarm |
|---|---|---|
| `validated` | done | the piece counts as verified |
| `validated-with-reserve` | done | verified, with a named gap that travels with the result |
| `rejected` | re-dispatched | blocks `close` |
| `needs-info` | waits for the coordinator's `answer` or `note` | blocks `close` |

Only a verifier may post a `verdict`. A coordinator that overrules a verdict must say so in a `note`
and in the final report; it may not silently ignore it.

## 10. Close gate

`close` MUST refuse when any of these holds, unless `--force`:

- an open question remains (a `question` whose `seq` appears in no `answer` or `verdict` `refs`);
- a worker has a brief but no `report`;
- a worker reported and the swarm has a verifier, but no verdict exists for that worker;
- a worker's latest verdict is `rejected` or `needs-info`;
- an **unresolved** `block` or `stall` remains: one that no later post references in `refs`.

A `block` or `stall` is resolved by `mure resolve <seq> --body "..."`, which posts a `note` carrying
`refs: [<seq>]`. Without that gesture, one outage would block the closure of the swarm forever, which
is exactly the kind of gate people learn to bypass with `--force`.

`--force` writes `meta.forced = true` on the `done` post and the final report to the human MUST then
list what is unresolved.

A close is the only post that may follow another `done`; every other write to a closed swarm is
refused.

## 11. Scope and worktrees

`owns` and `must-not` are glob lists. `mure scope <@m>` first establishes **what changed since the
member's turn started**, then classifies each changed file.

The baseline is taken by `mure prompt` at dispatch: `git stash create` for tracked content (a commit
object of the working tree, produced without modifying it) plus the list of untracked files at that
moment. `scope` then diffs against that baseline, so a file that was already dirty before the turn is
not blamed on the member. Stored in `state.json` under `baselines`.

| Test | Result |
|---|---|
| matches a `must-not` glob | violation (`must-not-touch`) |
| `owns` is non-empty and matches no `owns` glob | violation (`outside owns`) |
| otherwise | clean |

Exit code 3 on any violation.

**Attribution limit.** A baseline separates a turn from what came before it; it cannot separate two
workers editing the same working tree at the same time. With concurrent workers in a shared tree,
`scope` is advisory and MUST be read as such; the coordinator is warned at dispatch and MUST either
serialise the turns or give each worker a worktree. This is the one place where the protocol cannot
enforce what it asks for, and pretending otherwise produces a false accusation against a correct
worker (observed in the first live run: each of two workers was blamed for the other's files). Globs: `*` = one path segment, `**` = any depth, `?` = one character,
a trailing `/` means `**`.

Worktrees exist because two agents editing the same working tree corrupt each other's diffs:

```bash
mure worktree <@m> --create   # git worktree add -b mure/<slug>/<m> .mure/<slug>/worktrees/<m>
mure worktree <@m> --remove   # refuses if dirty; --force discards the work
```

The branch is `mure/<slug>/<member>`. Removing a worktree deletes the member's working copy, so a
conforming coordinator lands or commits the work first. `member kill` refuses on a dirty worktree for
the same reason.

Merging the branches back is deliberately out of scope: the coordinator merges, in whatever order the
project wants, after the verdicts.

## 12. Stall detection

A stall is: every member is waiting, no question is open, and the swarm is not closed. The reference
implementation detects it (`doctor`, `runnable`) and the optional `monitor` member reports it with a
`stall` post naming who can restart the work.

The monitor is not a cron: it is dispatched like any other member, and only when the coordinator
notices silence. A monitor that fires on a timer is a quota leak, not a safety net.

## 13. Integrity checks (`doctor`)

A conforming implementation reports, at minimum:

- a line that is not valid JSON, or a `seq` that is not the previous `seq` + 1;
- an unknown sender, recipient, or kind;
- a `ref` that is forward, missing, or points at itself;
- a verifier that watches nobody, a worker that owns nothing;
- a closed swarm whose last post is not `done`;
- a swarm where nobody is runnable, nothing is open, and the swarm is not closed (the silent stall).

`doctor` exits non-zero when a hard problem (first three) is found, zero when only notes are printed.

## 14. Failure modes and recovery

| Symptom | Cause | Recovery |
|---|---|---|
| A member never posts | the harness dropped the turn, or the prompt was paraphrased | re-dispatch with `mure prompt`; check `mure inbox` shows the posts |
| Posts arrive twice | the same prompt was delivered to two agents | `member kill` one of them, keep the survivor's report |
| Cursor advanced, nothing was done | `prompt` printed but was never delivered | `mure cursor <@m> --reset`, then `prompt` again |
| Two workers fight over one file | the split was wrong | stop both, split by file, or put them on separate worktrees and merge |
| `close` refuses forever | a worker never reported, or a rejection was never fixed | dispatch the worker; or `close --force` and report what is open |
| The board is corrupt | a hand edit | `doctor` names the line; repair from the last valid line, never from memory |

## 15. Versioning

`meta.json.mure` records the protocol version. A minor bump may add kinds or fields; it must not
change the meaning of `seq`, of the wake rule, or of the verdict vocabulary. Readers must ignore
unknown `meta` keys.
