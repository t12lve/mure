# Changelog

All notable changes to Mure. Format: [Keep a Changelog](https://keepachangelog.com/), versioning:
[semver](https://semver.org/) on the *protocol* and the CLI together.

## [0.1.0] — 2026-11-15

First release. Preview quality: the protocol is stable enough to rely on, the CLI is not yet battle
tested on large swarms.

### Added

- `SKILL.md`: the method (seven-step loop, dispatch contract, verdict gate, close gate, quota
  discipline, red flags) for any harness that reads skills.
- `init --verify "<command>"`: the verification command is recorded on the swarm and carried into every
  member's prompt, so "done" never depends on memory.
- `scripts/mure.mjs`: dependency-free CLI — `init`, `member add|kill|list`, `post`, `answer`,
  `resolve`, `inbox`, `cursor`, `prompt`, `verdict`, `scope`, `worktree`, `runnable`, `status`, `open`,
  `board`, `graph`, `close`, `reopen`, `doctor`.
- Append-only JSONL board with monotone sequence numbers, explicit recipient expansion (`@all`,
  `@prefix*`), read cursors and a wake rule based on mentions alone.
- Verification gate: typed verdicts (`validated`, `validated-with-reserve`, `rejected`, `needs-info`),
  mandatory motif, mandatory and quotable reserve.
- Close gate: refuses on an open question, a worker that never reported, a worker who reported but was
  never judged while a verifier exists, a `rejected`/`needs-info` verdict, or an unresolved
  `block`/`stall`.
- Scope enforcement with a per-dispatch baseline (`git stash create` + untracked snapshot), so a file
  dirtied before a turn is not blamed on the worker.
- Optional per-worker git worktrees (`init --worktrees`, `mure worktree`), branch
  `mure/<slug>/<member>`.
- `docs/`: design rationale (FR), normative protocol (EN), harness adapters (EN), four worked
  examples with real board transcripts.
- `install.ps1` (Windows junction) and `install.sh` (symlink), CI on Linux/macOS/Windows, Node 18–22.

### Fixed after the first review

- Roles are now enforced: a worker can no longer post `done`, `brief` or `verdict`, and a monitor can
  no longer post `report`.
- `@all` no longer addresses killed members.
- Member names and swarm slugs are validated, which fixes broken mermaid ids and unsafe file paths.
- A `block`/`stall` is now resolvable (`mure resolve <seq>`), instead of blocking `close` forever.
- `close` now refuses a report that no verifier ever judged, as long as the swarm has a verifier.
- `mure verdict` finds the single verifier on its own instead of assuming `@verifier`.
- `changesSince` no longer creates a throwaway git object on every scope check.

### Known limits

- In a shared working tree, two concurrent workers cannot be told apart by `scope`; use worktrees.
- `prompt` advances the read cursor: a prompt lost between printing and delivery must be recovered with
  `mure cursor <@m> --reset`.
- Merging the `mure/*` branches back is the coordinator's job, not the tool's.
- A lost turn is indistinguishable from a turn never dispatched.
