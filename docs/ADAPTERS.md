# Adapters — running a Mure swarm in your harness

Mure itself is harness-agnostic: it is a board plus a CLI. What changes between harnesses is **how a
member turn is executed**. There are three execution models.

| Model | What it is | Cost | Isolation |
|---|---|---|---|
| **A. In-session subagent** | the coordinator spawns subagents from its own tool list | one agent per turn | shared or per-worktree |
| **B. Separate process** | the coordinator shells out to `codex exec`, `gemini -p`, `claude -p` | one process per turn, real parallelism | per-worktree or per-copy |
| **C. Sequential** | the coordinator asks for one turn at a time and pastes each prompt itself | lowest, slowest | shared |

Model A is the default in OpenCode and Claude Code. Model B is the only way to get true parallelism
from a harness without a subagent tool, and it is also the most robust: a crashed worker kills one
process, not the session.

Model C is a legitimate fallback, with one rule: **do not role-play the members yourself.** Running a
worker turn "in your head" and posting on its behalf produces a board that looks like a swarm and is
just you talking to yourself. If you use C, say so in the final report.

## Installing the skill

The skill is this directory: it must be visible to the harness under a directory named `mure`,
containing `SKILL.md`.

| Harness | Typical location |
|---|---|
| OpenCode | `~/.config/opencode/skills/mure` (global) or `<repo>/.opencode/skills/mure` |
| Claude Code | `~/.claude/skills/mure` |
| Codex CLI, Copilot CLI, Gemini CLI | `~/.agents/skills/mure` is the cross-runtime alias; otherwise the harness's own skills dir |
| Cursor / Windsurf / others | wherever the harness reads rule/skill folders, or paste `SKILL.md` into its rules |

Provide the folder by symlink or junction so `git pull` updates every harness at once:

```powershell
# Windows
.\install.ps1
```

```bash
# macOS / Linux
./install.sh
```

The junction points at this repository; the CLI is invoked through `node scripts/mure.mjs`, so no
`PATH` entry is required. If you want a short `mure` command, add an alias to your shell profile —
the skill never assumes one.

## OpenCode

**Execution model A.** OpenCode exposes a `subagent` tool: it starts a child session with its own
context and returns when the child goes idle.

```
1. mure runnable                     -> who has work
2. mure prompt "@parser"             -> the turn prompt (advances the cursor)
3. subagent(agent: "general", prompt: <that text>)   -> one child session per member
4. wait for idle, then mure status
```

Details that matter:

- **Parallelism is real.** Two `subagent` calls in one message run concurrently. Dispatch up to
  `max-parallel` at once.
- **Continuity.** The returned `sessionID` is the member's memory. Send a follow-up to the same id
  when a worker must fix a rejection, so it keeps what it learned; start a new session when the
  member should re-read the board cold.
- **Model per role.** Pass `model` on the subagent call to give the verifier a different model from
  the workers — the cheapest way to get an adversarial second opinion.
- **Worktrees.** OpenCode has native worktree helpers; `mure worktree` uses plain `git`, which is
  equivalent and keeps the board portable. Do not mix the two for the same member.
- **Permissions.** The child inherits your permission settings. A worker that cannot write in its
  own scope will report a fake success; keep write access on, scope enforced by `mure scope`.

## Claude Code

**Execution model A.** Claude Code's delegation tool is `Task`, and its prompt is a single string.

```
1. mure prompt "@api"
2. Task(subagent_type: "general-purpose", description: "mure @api", prompt: <that text>)
```

- Subagents run with their own context; they do not see your conversation, which is exactly what the
  dispatch prompt is for.
- Claude Code's hooks are a good place to enforce `mure scope` before a worker stops, if your version
  supports a stop hook.
- For long runs, model B is often better: `claude -p "$(mure prompt @api)"` in a subshell gives you a
  process you can kill.

## Codex CLI

**Execution model B** (no in-session subagent tool in most builds).

```bash
mure prompt "@parser" --no-advance > /tmp/turn-parser.md
codex exec "$(cat /tmp/turn-parser.md)"        # check `codex exec --help` in your version
mure cursor "@parser" --reset                  # only if the process never started
```

- Run each worker in its own worktree, in its own shell, in the background; collect the exit code.
- `--no-advance` plus an explicit cursor reset is the safe pattern for scripted runs: you advance the
  cursor only after the process actually started.
- Approvals: a non-interactive run needs unattended write permission, which is precisely why the
  scope check exists. Keep `must-not` tight.

## Gemini CLI

**Execution model B.** Non-interactive mode takes a prompt and exits:

```bash
mure prompt "@api" --no-advance > turn.md
gemini -p "$(cat turn.md)"
```

Same rules as Codex: one worktree per member, advance the cursor only after launch, keep the prompt
verbatim (a plain file avoids shell quoting damage on long boards).

## Cursor and other editors

**Execution model A or C.** If the editor can spawn background agents, treat them like subagents: one
prompt per agent, parallel only when scopes do not overlap. If it cannot, run model C and say so.

## Any harness: the manual loop

When nothing else is available, the protocol still works with two terminals:

```bash
# terminal 1 - coordinator
mure status
mure prompt "@parser"        # copy the output

# terminal 2 - the worker's agent
#   paste the prompt, let it work, it posts its own report
```

The board does not care how the turn was executed. It only cares that exactly one post appeared, from
the member that did the work.

## Portability rules (all harnesses)

1. **Never let the harness rewrite the prompt.** Formatting, summarizing or "improving" it breaks the
   cursor contract: the text that was printed is the text that must be delivered.
2. **One prompt, one process.** Delivering the same prompt twice advances one cursor and duplicates
   work.
3. **Check `mure runnable` before every round.** It is the only source of truth about who has work.
4. **Kill by process, not by hope.** Model B gives you a PID; model A gives you a session to abandon.
   Either way, if a turn is lost, re-dispatch it; the board notices nothing was posted.
5. **Worktrees for parallel writers, always** — unless the pieces provably touch disjoint files and
   the build does not write shared artifacts.
6. **The final report is yours.** No harness writes it for you: what was verified, by which command,
   what was not, and what remains open.
