import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../scripts/mure.mjs', import.meta.url));

function tmp(prefix = 'mure-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, { cwd, expect = 0 } = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (expect !== 0) assert.fail(`expected exit ${expect}, got 0\n${out}`);
    return { code: 0, out };
  } catch (e) {
    const code = e.status ?? 1;
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    if (expect === code) return { code, out };
    assert.fail(`expected exit ${expect}, got ${code}\n${out}`);
  }
}

function swarm({ goal = 'test goal', maxParallel = 2 } = {}) {
  const dir = tmp();
  run(['init', 'demo', '--goal', goal, '--max-parallel', String(maxParallel)], { cwd: dir });
  return dir;
}

function withWorkers(dir) {
  run(['member', 'add', '@a', '--role', 'worker', '--owns', 'src/a.js', '--done', 'a works'], { cwd: dir });
  run(['member', 'add', '@b', '--role', 'worker', '--owns', 'src/b.js', '--done', 'b works'], { cwd: dir });
  run(['member', 'add', '@verifier', '--role', 'verifier', '--watches', '@a,@b', '--done', 'tests run'], { cwd: dir });
  return dir;
}

test('init creates the board and refuses a duplicate slug', () => {
  const dir = swarm({ goal: 'un objectif' });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '.mure', 'demo', 'meta.json'), 'utf8'));
  assert.equal(meta.slug, 'demo');
  assert.equal(meta.goal, 'un objectif');
  assert.equal(meta.maxParallel, 2);
  assert.equal(meta.closed, null);
  assert.equal(fs.readFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), 'utf8'), '');
  const again = run(['init', 'demo', '--goal', 'x'], { cwd: dir, expect: 1 });
  assert.match(again.out, /already exists/);
});

test('a member gets a brief file and shows in members', () => {
  const dir = swarm();
  run(['member', 'add', '@a', '--role', 'worker', '--owns', 'src/a.js', '--must-not', 'src/b.js', '--done', 'a works'], { cwd: dir });
  const brief = fs.readFileSync(path.join(dir, '.mure', 'demo', 'briefs', 'a.md'), 'utf8');
  assert.match(brief, /owns: src\/a\.js/);
  assert.match(brief, /must-not-touch: src\/b\.js/);
  assert.match(brief, /done-means: a works/);
  const listed = run(['members'], { cwd: dir }).out;
  assert.match(listed, /@coordinator/);
  assert.match(listed, /@a/);
});

test('posts are numbered, @all is expanded, unknown kinds are refused', () => {
  const dir = withWorkers(swarm());
  const p1 = run(['post', '--from', '@coordinator', '--to', '@all', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  assert.match(p1.out, /^#1 posted/m);
  const board = fs
    .readFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual(board[0].to.sort(), ['a', 'b', 'coordinator', 'verifier']);
  assert.equal(board[0].seq, 1);
  const bad = run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'nope', '--body', 'x'], { cwd: dir, expect: 1 });
  assert.match(bad.out, /unknown kind/);
  const unknown = run(['post', '--from', '@ghost', '--to', '@a', '--kind', 'note', '--body', 'x'], { cwd: dir, expect: 1 });
  assert.match(unknown.out, /unknown sender/);
});

test('a question needs an answer before the swarm can close', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'question', '--body', 'which format?'], { cwd: dir });
  const open = run(['open'], { cwd: dir }).out;
  assert.match(open, /which format\?/);
  const refused = run(['close', '--summary', 'x'], { cwd: dir, expect: 1 });
  assert.match(refused.out, /question/);
  run(['answer', '3', '--from', '@coordinator', '--body', 'json'], { cwd: dir });
  assert.match(run(['open'], { cwd: dir }).out, /no open question/);
});

test('inbox advances the cursor, --peek does not, prompt refuses an empty delivery', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  const peek = run(['inbox', '@a', '--peek'], { cwd: dir }).out;
  assert.match(peek, /1 unread/);
  assert.match(run(['inbox', '@a'], { cwd: dir }).out, /1 unread/);
  assert.match(run(['inbox', '@a'], { cwd: dir }).out, /nothing new/);
  const refused = run(['prompt', '@a'], { cwd: dir, expect: 1 });
  assert.match(refused.out, /nothing unread/);
});

test('prompt carries the brief and the unread posts, and advances the cursor', () => {
  const dir = withWorkers(swarm({ goal: 'objectif accentue' }));
  run(['post', '--from', '@coordinator', '--to', '@a,@b', '--kind', 'brief', '--body', 'one file each'], { cwd: dir });
  const p = run(['prompt', '@a'], { cwd: dir }).out;
  assert.match(p, /# Mure dispatch - @a \(worker\)/);
  assert.match(p, /owns: src\/a\.js/);
  assert.match(p, /one file each/);
  assert.match(p, /objectif accentue/);
  assert.match(p, /Then stop/);
  assert.match(run(['inbox', '@a'], { cwd: dir }).out, /nothing new/);
  const runnable = run(['runnable'], { cwd: dir }).out;
  assert.doesNotMatch(runnable, /@a\s+worker/);
  assert.match(runnable, /@b/);
});

test('verdicts are typed and a reserve is mandatory with validated-with-reserve', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
  const missingMotif = run(['verdict', '@a', '--verdict', 'validated'], { cwd: dir, expect: 1 });
  assert.match(missingMotif.out, /motif/);
  const badValue = run(['verdict', '@a', '--verdict', 'ok', '--motif', 'fine'], { cwd: dir, expect: 1 });
  assert.match(badValue.out, /--verdict must be/);
  const noReserve = run(['verdict', '@a', '--verdict', 'validated-with-reserve', '--motif', 'fine'], { cwd: dir, expect: 1 });
  assert.match(noReserve.out, /--reserve is required/);
  run(['verdict', '@a', '--verdict', 'validated-with-reserve', '--motif', 'fine', '--reserve', 'no -0 case'], { cwd: dir });
  const board = fs.readFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const v = board[board.length - 1];
  assert.equal(v.kind, 'verdict');
  assert.equal(v.meta.verdict, 'validated-with-reserve');
  assert.equal(v.meta.reserve, 'no -0 case');
  assert.ok(v.refs.includes(1));
});

test('close refuses an unreported worker and a rejected verdict, then succeeds', () => {
  const dir = withWorkers(swarm());
  const never = run(['close', '--summary', 'x'], { cwd: dir, expect: 1 });
  assert.match(never.out, /never posted a report/);
  run(['post', '--from', '@a', '--to', '@verifier', '--kind', 'report', '--body', 'a done'], { cwd: dir });
  run(['post', '--from', '@b', '--to', '@verifier', '--kind', 'report', '--body', 'b done'], { cwd: dir });
  run(['verdict', '@a', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir });
  run(['verdict', '@b', '--verdict', 'rejected', '--motif', 'no test'], { cwd: dir });
  const blocked = run(['close', '--summary', 'x'], { cwd: dir, expect: 1 });
  assert.match(blocked.out, /rejected/);
  run(['verdict', '@b', '--verdict', 'validated', '--motif', 'fixed'], { cwd: dir });
  const closed = run(['close', '--summary', 'all good'], { cwd: dir });
  assert.match(closed.out, /closed/);
  const post = run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'note', '--body', 'late'], { cwd: dir, expect: 1 });
  assert.match(post.out, /closed/);
  run(['reopen'], { cwd: dir });
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'note', '--body', 'after reopen'], { cwd: dir });
});

test('doctor is clean on a normal run and names a corrupt board', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
  assert.match(run(['doctor'], { cwd: dir }).out, /board: clean/);
  fs.appendFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), '{"seq": 9, "from": "@ghost", "to": ["@nobody"], "kind": "report"}\n');
  const bad = run(['doctor'], { cwd: dir, expect: 1 });
  assert.match(bad.out, /expected seq 3/);
  assert.match(bad.out, /unknown sender @ghost/);
  assert.match(bad.out, /unknown recipient @nobody/);
});

test('kill is permanent and cannot touch the coordinator', () => {
  const dir = withWorkers(swarm());
  const coord = run(['member', 'kill', '@coordinator'], { cwd: dir, expect: 1 });
  assert.match(coord.out, /cannot be killed/);
  run(['member', 'kill', '@b', '--reason', 'duplicate'], { cwd: dir });
  assert.match(run(['members'], { cwd: dir }).out, /killed/);
});

test('graph emits mermaid with weighted edges', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a,@b', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
  const g = run(['graph'], { cwd: dir }).out;
  assert.match(g, /flowchart LR/);
  assert.match(g, /coordinator -->\|1\| a/);
  assert.match(g, /a -->\|1\| coordinator/);
});

test('roles are enforced on post kinds', () => {
  const dir = withWorkers(swarm());
  run(['member', 'add', '@mon', '--role', 'monitor', '--done', 'watch'], { cwd: dir });
  const done = run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'done', '--body', 'i close'], { cwd: dir, expect: 1 });
  assert.match(done.out, /cannot post a "done"/);
  const brief = run(['post', '--from', '@a', '--to', '@b', '--kind', 'brief', '--body', 'you do b'], { cwd: dir, expect: 1 });
  assert.match(brief.out, /cannot post a "brief"/);
  const report = run(['post', '--from', '@mon', '--to', '@a', '--kind', 'report', '--body', 'i report'], { cwd: dir, expect: 1 });
  assert.match(report.out, /cannot post a "report"/);
  const verdict = run(['verdict', '@a', '--verdict', 'validated', '--motif', 'x', '--from', '@a'], { cwd: dir, expect: 1 });
  assert.match(verdict.out, /only a verifier/);
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
});

test('@all skips killed members and unknown recipients are refused', () => {
  const dir = withWorkers(swarm());
  run(['member', 'kill', '@b'], { cwd: dir });
  run(['post', '--from', '@coordinator', '--to', '@all', '--kind', 'note', '--body', 'hello'], { cwd: dir });
  const board = fs.readFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(board[board.length - 1].to.sort(), ['a', 'coordinator', 'verifier']);
  const typo = run(['post', '--from', '@coordinator', '--to', '@ghost', '--kind', 'note', '--body', 'x'], { cwd: dir, expect: 1 });
  assert.match(typo.out, /unknown recipient/);
});

test('invalid member names and slugs are refused', () => {
  const dir = swarm();
  const badName = run(['member', 'add', 'bad name', '--role', 'worker', '--owns', 'x', '--done', 'd'], { cwd: dir, expect: 1 });
  assert.match(badName.out, /invalid member name/);
  const badSlug = run(['init', 'Bad Slug', '--goal', 'x'], { cwd: dir, expect: 1 });
  assert.match(badSlug.out, /invalid slug/);
  run(['member', 'add', '@fix-1', '--role', 'worker', '--owns', 'x', '--done', 'd'], { cwd: dir });
});

test('a block can be resolved, and only then does close succeed', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'block', '--body', 'registry down'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'a done'], { cwd: dir });
  run(['post', '--from', '@b', '--to', '@coordinator', '--kind', 'report', '--body', 'b done'], { cwd: dir });
  run(['verdict', '@a', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir });
  run(['verdict', '@b', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir });
  const blocked = run(['close', '--summary', 'x'], { cwd: dir, expect: 1 });
  assert.match(blocked.out, /unresolved block\/stall/);
  run(['resolve', '2', '--from', '@coordinator', '--body', 'registry back'], { cwd: dir });
  const closed = run(['close', '--summary', 'ok'], { cwd: dir });
  assert.match(closed.out, /closed/);
});

test('a killed member cannot be dispatched, and status says who never reported', () => {
  const dir = withWorkers(swarm());
  run(['member', 'kill', '@b'], { cwd: dir });
  const killed = run(['prompt', '@b'], { cwd: dir, expect: 1 });
  assert.match(killed.out, /was killed/);
  const st = run(['status'], { cwd: dir }).out;
  assert.match(st, /never reported/);
});

test('close refuses a report no verifier ever judged', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@coordinator', '--to', '@a,@b', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'a done'], { cwd: dir });
  run(['post', '--from', '@b', '--to', '@coordinator', '--kind', 'report', '--body', 'b done'], { cwd: dir });
  run(['verdict', '@a', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir });
  const blocked = run(['close', '--summary', 'x'], { cwd: dir, expect: 1 });
  assert.match(blocked.out, /no verifier ever judged/);
  run(['verdict', '@b', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir });
  run(['close', '--summary', 'ok'], { cwd: dir });
});

test('verdict finds the single verifier on its own', () => {
  const dir = withWorkers(swarm());
  run(['post', '--from', '@a', '--to', '@coordinator', '--kind', 'report', '--body', 'done'], { cwd: dir });
  const out = run(['verdict', '@a', '--verdict', 'validated', '--motif', 'ok'], { cwd: dir }).out;
  assert.match(out, /verdict validated on @a/);
});

test('init records the verification command and prompts carry it', () => {
  const dir = tmp();
  run(['init', 'demo', '--goal', 'g', '--verify', 'npm test'], { cwd: dir });
  run(['member', 'add', '@verifier', '--role', 'verifier', '--done', 'run it'], { cwd: dir });
  assert.match(run(['status'], { cwd: dir }).out, /verify {2}npm test/);
  run(['post', '--from', '@coordinator', '--to', '@verifier', '--kind', 'note', '--body', 'go'], { cwd: dir });
  assert.match(run(['prompt', '@verifier'], { cwd: dir }).out, /verification command: `npm test`/);
});

test('version is the same in package.json, the CLI and the skill', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const cli = run(['version']).out.trim();
  const skill = fs.readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
  assert.equal(cli, pkg.version);
  assert.match(skill, new RegExp(`version: ${pkg.version.replace(/\./g, '\\.')}`));
});

test('board keeps the tail and says how much it hid', () => {
  const dir = withWorkers(swarm());
  ['alpha', 'beta', 'gamma'].forEach((n) => run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'note', '--body', n], { cwd: dir }));
  const tail = run(['board', '--tail', '2'], { cwd: dir }).out;
  assert.match(tail, /1 earlier post\(s\) not shown/);
  assert.match(tail, /gamma/);
  assert.doesNotMatch(tail, /alpha/);
  assert.doesNotMatch(run(['board', '--all'], { cwd: dir }).out, /not shown/);
});

test('a post body can come from a file, quotes and all', () => {
  const dir = withWorkers(swarm());
  const file = path.join(dir, 'body.md');
  fs.writeFileSync(file, 'line "quoted" and a \\ backslash\nsecond line', 'utf8');
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'note', '--body-file', file], { cwd: dir });
  const board = fs.readFileSync(path.join(dir, '.mure', 'demo', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.match(board[0].body, /"quoted"/);
  assert.match(board[0].body, /second line/);
});

test('scope follows the baseline and catches an out-of-scope edit', { skip: !hasGit() }, () => {
  const dir = tmp();
  git(dir, ['init', '-q']);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.mure/\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  run(['init', 'demo', '--goal', 'scope'], { cwd: dir });
  run(['member', 'add', '@a', '--role', 'worker', '--owns', 'src/a.js', '--done', 'a'], { cwd: dir });
  run(['post', '--from', '@coordinator', '--to', '@a', '--kind', 'brief', '--body', 'go'], { cwd: dir });
  run(['prompt', '@a'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a changed\n');
  assert.match(run(['scope', '@a'], { cwd: dir }).out, /src\/a\.js/);
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b changed\n');
  const violation = run(['scope', '@a'], { cwd: dir, expect: 3 });
  assert.match(violation.out, /VIOLATION src\/b\.js/);
});

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
