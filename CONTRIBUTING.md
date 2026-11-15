# Contributing

Mure is small on purpose: one skill file, one dependency-free CLI, a spec. Changes are welcome if
they keep it that way.

## Ground rules

1. **A protocol rule that the code does not refuse does not exist.** If you add a rule to
   `docs/PROTOCOL.md`, add the enforcement in `scripts/mure.mjs` and a test that fails without it.
2. **No runtime dependencies.** Node 18+ standard library only. `git` is called as a subprocess, never
   reimplemented.
3. **The board stays append-only.** New behaviour is a new post kind or a new derived view, not an
   edit of an existing record.
4. **`SKILL.md` is the product.** If a change makes the skill harder to follow, the change is probably
   wrong.

## Running the tests

```bash
node --test test
```

Every test creates its own temporary repository; nothing touches your working tree. The `scope` test
is skipped when `git` is absent.

## Before you open a pull request

- [ ] `node --test test` is green
- [ ] New behaviour has a test, and you verified the test fails without the change (mutate the guard,
      watch it go red, restore)
- [ ] `node scripts/mure.mjs doctor` still reports `board: clean` on a demo swarm
- [ ] Docs updated: `SKILL.md` for the method, `docs/PROTOCOL.md` for the rules, `docs/EXAMPLES.md`
      if you changed an output format
- [ ] The change is one idea, not three

## Reporting a bug

Include: the command, the board excerpt (`mure board --tail 20 --markdown`), the output of
`mure doctor`, and your OS + `node --version`. A board excerpt is worth more than a description.

## What is out of scope

Merging branches automatically, a hosted service, a web UI, and anything that requires an account or a
network call. See "Ce qui reste à construire" in `docs/DESIGN.md` for the ideas that are welcome.
