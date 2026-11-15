#!/usr/bin/env node
/**
 * mure.mjs - shared board for a Mure swarm of coding agents.
 *
 * Zero dependencies. Node 18+. Windows / macOS / Linux.
 * The board is append-only JSONL; every other file is derived state.
 *
 * See docs/PROTOCOL.md for the normative spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';
const KINDS = ['brief', 'report', 'question', 'answer', 'claim', 'verdict', 'status', 'stall', 'note', 'done', 'block'];
const ROLES = ['coordinator', 'worker', 'verifier', 'monitor'];
const VERDICTS = ['validated', 'validated-with-reserve', 'rejected', 'needs-info'];
const ROLE_KINDS = {
  coordinator: ['brief', 'report', 'note', 'answer', 'done', 'status', 'question', 'block'],
  worker: ['report', 'question', 'claim', 'answer', 'note', 'status', 'block'],
  verifier: ['verdict', 'question', 'answer', 'note', 'status', 'block'],
  monitor: ['stall', 'question', 'answer', 'note', 'status', 'block'],
};
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- utilities

function die(msg, code = 1) {
  process.stderr.write(`mure: ${msg}\n`);
  process.exit(code);
}
function warn(msg) {
  process.stderr.write(`mure: warning: ${msg}\n`);
}
function ok(msg) {
  process.stdout.write(`${msg}\n`);
}
function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    die(`cannot read ${file}: ${e.message}`);
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function stripAt(name) {
  return String(name || '').replace(/^@/, '').trim();
}
function at(name) {
  return `@${stripAt(name)}`;
}
function list(value) {
  if (value === undefined || value === true || value === false) return [];
  return String(value)
    .split(',')
    .map((s) => stripAt(s))
    .filter(Boolean);
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let val;
      const eq = key.indexOf('=');
      if (eq > -1) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      if (val === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          val = next;
          i += 1;
        } else {
          val = true;
        }
      }
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}
function ascii(s) {
  // Keep CLI output readable on legacy Windows consoles.
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0a\x20-\x7e]/g, '?');
}
function pad(s, n) {
  const v = ascii(s);
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}
function truncate(s, n) {
  const v = String(s).replace(/\s+/g, ' ').trim();
  return v.length <= n ? v : `${v.slice(0, n - 1)}...`;
}
function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: opts.stdio || ['ignore', 'pipe', 'pipe'] });
}
function isGitRepo(dir) {
  try {
    git(dir, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- globs

function globToRegExp(glob) {
  let g = String(glob).replace(/\\/g, '/').trim();
  if (g.startsWith('./')) g = g.slice(2);
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i += 1;
        if (g[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  const f = String(file).replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(f));
}

// ----------------------------------------------------------------- context

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.mure'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function context(args) {
  const explicit = args.root ? path.resolve(String(args.root)) : null;
  const root = explicit || findRoot(process.cwd()) || process.cwd();
  const base = path.join(root, '.mure');
  if (!fs.existsSync(base)) {
    die(`no .mure directory in ${root} (run: mure init <slug> --goal "...")`);
  }
  const swarmsDir = base;
  const slugs = fs
    .readdirSync(swarmsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(swarmsDir, d.name, 'meta.json')))
    .map((d) => d.name);
  let slug = args.swarm ? String(args.swarm) : process.env.MURE_SWARM || null;
  if (!slug) {
    const open = slugs.filter((s) => !readJson(path.join(swarmsDir, s, 'meta.json'), {}).closed);
    const pool = open.length ? open : slugs;
    if (pool.length === 1) slug = pool[0];
    else if (!pool.length) die('no swarm in this repository (run: mure init <slug> --goal "...")');
    else die(`several swarms here (${pool.join(', ')}); pass --swarm <slug>`);
  }
  if (!slugs.includes(slug)) die(`unknown swarm "${slug}" (found: ${slugs.join(', ') || 'none'})`);
  const dir = path.join(swarmsDir, slug);
  const sw = {
    root,
    base,
    slug,
    dir,
    metaFile: path.join(dir, 'meta.json'),
    membersFile: path.join(dir, 'members.json'),
    cursorsFile: path.join(dir, 'cursors.json'),
    stateFile: path.join(dir, 'state.json'),
    board: path.join(dir, 'board.jsonl'),
    briefs: path.join(dir, 'briefs'),
    worktrees: path.join(dir, 'worktrees'),
  };
  sw.meta = readJson(sw.metaFile, {});
  sw.members = readJson(sw.membersFile, { members: {} }).members;
  sw.cursors = readJson(sw.cursorsFile, {});
  sw.state = readJson(sw.stateFile, { baselines: {} });
  return sw;
}

function readBoard(sw) {
  if (!fs.existsSync(sw.board)) return [];
  const raw = fs.readFileSync(sw.board, 'utf8');
  const out = [];
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      die(`board is corrupt at line ${i + 1}: ${e.message}`);
    }
  });
  return out;
}

function appendPost(sw, rec) {
  const board = readBoard(sw);
  if (sw.meta.closed) die(`swarm "${sw.slug}" is closed; reopen with: mure reopen`);
  const seq = board.length ? board[board.length - 1].seq + 1 : 1;
  const post = { seq, ts: nowIso(), ...rec };
  fs.appendFileSync(sw.board, `${JSON.stringify(post)}\n`, 'utf8');
  return post;
}

function boardPathForPrompt(sw) {
  return path.relative(sw.root, sw.board).split(path.sep).join('/');
}

function cliForPrompt(sw) {
  const rel = path.relative(sw.root, SELF).split(path.sep).join('/');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('..')) return `node "${SELF}"`;
  return `node ./${rel}`;
}

function run(sw, sub) {
  return `${cliForPrompt(sw)} --root "${sw.root}" --swarm ${sw.slug} ${sub}`;
}

// -------------------------------------------------------------- state views

function memberRole(sw, name) {
  return sw.members[stripAt(name)]?.role || 'unknown';
}

function resolveRecipients(sw, to) {
  const out = [];
  for (const raw of to) {
    if (raw === 'all') {
      Object.keys(sw.members).filter((m) => !killed(sw, m)).forEach((m) => out.push(m));
      continue;
    }
    const direct = stripAt(raw);
    if (sw.members[direct]) {
      out.push(direct);
      continue;
    }
    if (direct.endsWith('*')) {
      const prefix = direct.slice(0, -1);
      Object.keys(sw.members).filter((m) => m.startsWith(prefix)).forEach((m) => out.push(m));
      continue;
    }
    out.push(direct);
  }
  return [...new Set(out)];
}

function allowedKinds(sw, name) {
  return ROLE_KINDS[memberRole(sw, name)] || [];
}

function addressed(post, name) {
  const n = stripAt(name);
  return post.to.map(stripAt).includes(n);
}

function unreadFor(sw, name, board = readBoard(sw)) {
  const cursor = sw.cursors[stripAt(name)] || 0;
  return board.filter((p) => p.seq > cursor && addressed(p, name));
}

function killed(sw, name) {
  return Boolean(sw.members[stripAt(name)]?.killed);
}

function runnable(sw, board = readBoard(sw)) {
  return Object.keys(sw.members)
    .filter((n) => !killed(sw, n))
    .map((n) => ({ name: n, posts: unreadFor(sw, n, board) }))
    .filter((m) => m.posts.length > 0);
}

function openQuestions(sw, board = readBoard(sw)) {
  const answered = new Set();
  board.filter((p) => p.kind === 'answer' || p.kind === 'verdict').forEach((p) => (p.refs || []).forEach((r) => answered.add(r)));
  return board.filter((p) => p.kind === 'question' && !answered.has(p.seq));
}

function unresolvedBlocks(sw, board = readBoard(sw)) {
  const cleared = new Set();
  board.forEach((p) => (p.refs || []).forEach((r) => cleared.add(r)));
  return board.filter((p) => ['block', 'stall'].includes(p.kind) && !cleared.has(p.seq));
}

function verdictsFor(sw, board, worker) {
  const n = stripAt(worker);
  return board.filter((p) => p.kind === 'verdict' && addressed(p, n));
}

function lastVerdict(sw, board, worker) {
  const v = verdictsFor(sw, board, worker);
  return v.length ? v[v.length - 1] : null;
}

function renderPost(post, opts = {}) {
  const to = post.to.map(at).join(' ');
  const head = `#${post.seq} ${post.ts} ${at(post.from)} -> ${to} (${post.kind})`;
  const refs = post.refs && post.refs.length ? ` refs=${post.refs.map((r) => `#${r}`).join(',')}` : '';
  const motif = post.meta && post.meta.verdict ? ` [${post.meta.verdict}]` : '';
  const body = opts.short ? truncate(post.body, 160) : post.body;
  return `${head}${refs}${motif}\n${opts.short ? body : body.replace(/^/gm, '  ')}`;
}

function statusLine(sw, name, posts, board) {
  const m = sw.members[name] || {};
  if (m.killed) return 'killed';
  if (m.role === 'coordinator') return `you (${posts.length} unread)`;
  if (posts.length) return `runnable (${posts.length} unread)`;
  if (m.role === 'worker' && !board.some((p) => stripAt(p.from) === name && p.kind === 'report')) return 'never reported';
  const last = lastVerdict(sw, board, name);
  if (last && last.meta?.verdict) return `waiting (last verdict: ${last.meta.verdict})`;
  return 'waiting';
}

// --------------------------------------------------------------- commands

function cmdInit(args) {
  const slug = args._[1];
  if (!slug) die('usage: mure init <slug> --goal "..." [--verify "npm test"] [--max-parallel N] [--worktrees]');
  if (!SLUG_RE.test(String(slug))) die(`invalid slug "${slug}": use lowercase letters, digits and hyphens (max 40)`);
  const root = args.root ? path.resolve(String(args.root)) : path.resolve(process.cwd());
  const base = path.join(root, '.mure');
  const dir = path.join(base, slug);
  if (fs.existsSync(path.join(dir, 'meta.json'))) die(`swarm "${slug}" already exists in ${root}`);
  fs.mkdirSync(path.join(dir, 'briefs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'worktrees'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'board.jsonl'), '', 'utf8');
  const meta = {
    mure: VERSION,
    slug,
    goal: args.goal ? String(args.goal) : '',
    verify: args.verify ? String(args.verify) : '',
    created: nowIso(),
    closed: null,
    maxParallel: Number(args['max-parallel'] || 4),
    worktrees: Boolean(args.worktrees),
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  writeJson(path.join(dir, 'members.json'), {
    members: {
      coordinator: { name: 'coordinator', role: 'coordinator', created: nowIso() },
    },
  });
  writeJson(path.join(dir, 'cursors.json'), {});
  const needsGitignore = isGitRepo(root) && !/(^|\n)\.mure\//.test(fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '');
  ok(`swarm "${slug}" created in ${path.join('.mure', slug)}`);
  ok(`board: ${path.join('.mure', slug, 'board.jsonl')}`);
  if (needsGitignore) {
    ok('');
    ok('tip: .mure/ is not ignored yet. Add this line to .gitignore so the board stays local:');
    ok('  .mure/');
  }
  ok('');
  ok('next: add members, then post their briefs.');
  ok(`  ${cliForPrompt({ root })} --root "${root}" member add "@parser" --role worker --owns "src/parser/**" --done "tests for parser pass"`);
  ok(`  ${cliForPrompt({ root })} --root "${root}" post --from "@coordinator" --to "@all" --kind brief --body "..."`);
}

function cmdMember(args) {
  const sw = context(args);
  const sub = args._[1];
  if (sub === 'add') return memberAdd(sw, args);
  if (sub === 'kill' || sub === 'remove') return memberKill(sw, args);
  if (sub === 'list' || sub === undefined) return cmdMembers(args);
  die(`unknown subcommand "member ${sub}"`);
}

function memberAdd(sw, args) {
  const name = stripAt(args._[2]);
  if (!name) die('usage: mure member add <@name> --role worker|verifier|monitor --owns "glob" --must-not "glob" --done "criterion"');
  if (!NAME_RE.test(name)) die(`invalid member name "${name}": letters, digits, dot, dash, underscore (max 32)`);
  if (sw.members[name]) die(`member @${name} already exists`);
  const role = String(args.role || 'worker');
  if (!ROLES.includes(role)) die(`unknown role "${role}" (one of: ${ROLES.join(', ')})`);
  const member = {
    name,
    role,
    owns: list(args.owns),
    mustNot: list(args['must-not']),
    done: args.done ? String(args.done) : '',
    watches: list(args.watches),
    model: args.model ? String(args.model) : null,
    created: nowIso(),
    killed: null,
  };
  sw.members[name] = member;
  writeJson(sw.membersFile, { members: sw.members });
  const briefFile = path.join(sw.briefs, `${name}.md`);
  const lines = [
    `# Brief - @${name} (${role})`,
    '',
    `swarm: ${sw.slug}`,
    `goal: ${sw.meta.goal}`,
    `verify: ${sw.meta.verify || '(not declared)'}`,
    `owns: ${member.owns.join(', ') || '(nothing declared)'}`,
    `must-not-touch: ${member.mustNot.join(', ') || '(nothing declared)'}`,
    `done-means: ${member.done || '(not declared)'}`,
    member.watches.length ? `watches: ${member.watches.map(at).join(', ')}` : '',
    '',
  ].filter((l) => l !== '');
  fs.writeFileSync(briefFile, `${lines.join('\n')}\n`, 'utf8');
  ok(`added ${at(name)} (${role})`);
  ok(`brief: ${path.relative(sw.root, briefFile).split(path.sep).join('/')}`);
  if (role === 'worker' && sw.meta.worktrees) {
    try {
      const wt = createWorktree(sw, name);
      ok(`worktree: ${wt}`);
    } catch (e) {
      warn(`could not create a worktree for @${name}: ${e.message}`);
      warn('it will work in the shared workspace; scope checks are then advisory');
    }
  }
}

function createWorktree(sw, name) {
  if (!isGitRepo(sw.root)) throw new Error('not a git repository');
  const target = path.join(sw.worktrees, name);
  const branch = `mure/${sw.slug}/${name}`;
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    git(sw.root, ['worktree', 'add', '-b', branch, target]);
  } catch (e) {
    throw new Error((e.stderr || e.message || '').toString().trim());
  }
  return target;
}

function memberKill(sw, args) {
  const name = stripAt(args._[2]);
  if (!name) die('usage: mure member kill <@name> [--force]');
  const m = sw.members[name];
  if (!m) die(`unknown member @${name}`);
  if (m.role === 'coordinator') die('the coordinator cannot be killed');
  const wt = path.join(sw.worktrees, name);
  if (fs.existsSync(wt) && !args.force) {
    try {
      const dirty = git(wt, ['status', '--porcelain']).trim();
      if (dirty) die(`@${name} has uncommitted changes in its worktree; land them first, or pass --force`);
    } catch {
      warn(`could not inspect worktree of @${name}`);
    }
  }
  m.killed = nowIso();
  writeJson(sw.membersFile, { members: sw.members });
  appendPost(sw, {
    from: 'coordinator',
    to: [name],
    kind: 'status',
    body: `@${name} removed from the swarm${args.reason ? `: ${args.reason}` : ''}`,
    refs: [],
    meta: { event: 'member-killed' },
  });
  ok(`${at(name)} killed (permanent; the coordinator adds a new member instead)`);
}

function cmdMembers(args) {
  const sw = context(args);
  const rows = [['MEMBER', 'ROLE', 'STATE', 'OWNS']];
  Object.values(sw.members).forEach((m) => {
    rows.push([at(m.name), m.role, m.killed ? 'killed' : 'alive', (m.owns || []).join(' ') || '-']);
  });
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => ascii(r[i]).length)));
  rows.forEach((r) => ok(r.map((c, i) => pad(c, widths[i])).join('  ')));
}

function postBody(args) {
  if (args.stdin) return readStdin();
  if (args['body-file']) return fs.readFileSync(path.resolve(String(args['body-file'])), 'utf8');
  if (args.body !== undefined && args.body !== true) return String(args.body);
  return '';
}

function cmdPost(args) {
  const sw = context(args);
  const from = stripAt(args.from);
  if (!from) die('usage: mure post --from @name --to @a,@b --kind <kind> --body "..."');
  if (!sw.members[from]) die(`unknown sender @${from}; add it with: mure member add @${from} --role ...`);
  const to = resolveRecipients(sw, list(args.to));
  if (!to.length) die('a post needs at least one recipient (--to @name,@other or --to @all)');
  const unknown = to.filter((n) => !sw.members[n]);
  if (unknown.length && !args.force) {
    die(`unknown recipient(s) ${unknown.map(at).join(' ')}; a post nobody reads stalls the swarm (--force to send anyway)`);
  }
  const kind = String(args.kind || 'note');
  if (!KINDS.includes(kind)) die(`unknown kind "${kind}" (one of: ${KINDS.join(', ')})`);
  const allowed = allowedKinds(sw, from);
  if (!allowed.includes(kind)) {
    die(`@${from} is a ${memberRole(sw, from)} and cannot post a "${kind}" (allowed: ${allowed.join(', ')})`);
  }
  if (kind === 'brief') {
    const premature = to.filter((n) => sw.members[n] && sw.members[n].role === 'verifier');
    if (premature.length) {
      warn(`a brief to ${premature.map(at).join(' ')} wakes the verifier before any report exists;`);
      warn('post the plan to the workers, then wake the verifier with a note once reports are in');
    }
  }
  const body = postBody(args).trim();
  if (!body && kind !== 'status') die('empty body');
  const refs = list(args.ref).map(Number).filter((n) => Number.isFinite(n));
  refs.forEach((r) => {
    if (r < 1 || r >= (readBoard(sw).length + 1)) die(`--ref ${r} does not exist on the board`);
  });
  if (kind === 'question' && to.every((n) => n === from)) die('a question needs another member as recipient');
  const rec = appendPost(sw, { from, to, kind, body, refs, meta: args.meta ? JSON.parse(String(args.meta)) : {} });
  ok(`#${rec.seq} posted ${at(from)} -> ${to.map(at).join(' ')} (${kind})`);
}

function cmdResolve(args) {
  const sw = context(args);
  const seq = Number(args._[1] || args.on);
  if (!seq) die('usage: mure resolve <seq> --from @name --body "..."');
  const board = readBoard(sw);
  const blocked = board.find((p) => p.seq === seq);
  if (!blocked) die(`no post #${seq}`);
  if (!['block', 'stall'].includes(blocked.kind)) warn(`#${seq} is a ${blocked.kind}, not a block or stall`);
  const from = stripAt(args.from || 'coordinator');
  if (!sw.members[from]) die(`unknown member @${from}`);
  const allowed = allowedKinds(sw, from);
  if (!allowed.includes('note')) die(`@${from} cannot post a note`);
  const body = postBody(args).trim() || `#${seq} resolved`;
  const rec = appendPost(sw, { from, to: [stripAt(blocked.from)], kind: 'note', body, refs: [seq], meta: { event: 'resolved' } });
  ok(`#${rec.seq} clears #${seq} -> ${at(blocked.from)}`);
}

function cmdAnswer(args) {
  const sw = context(args);
  const seq = Number(args._[1] || args.on);
  if (!seq) die('usage: mure answer <seq> --from @name --body "..."');
  const board = readBoard(sw);
  const q = board.find((p) => p.seq === seq);
  if (!q) die(`no post #${seq}`);
  if (q.kind !== 'question') warn(`#${seq} is a ${q.kind}, not a question`);
  const from = stripAt(args.from);
  if (!from) die('--from is required');
  const body = postBody(args).trim();
  if (!body) die('empty body');
  const rec = appendPost(sw, { from, to: [stripAt(q.from)], kind: 'answer', body, refs: [seq], meta: {} });
  ok(`#${rec.seq} answers #${seq} -> ${at(q.from)}`);
}

function cmdInbox(args) {
  const sw = context(args);
  const name = stripAt(args._[1]);
  if (!name) die('usage: mure inbox <@name> [--peek] [--json]');
  if (!sw.members[name]) die(`unknown member @${name}`);
  const board = readBoard(sw);
  const posts = unreadFor(sw, name, board);
  if (args.json) {
    ok(JSON.stringify({ member: at(name), unread: posts.length, posts }, null, 2));
  } else if (!posts.length) {
    ok(`@${name}: nothing new (waiting, costs nothing)`);
  } else {
    ok(`@${name}: ${posts.length} unread`);
    posts.forEach((p) => ok(`\n${renderPost(p)}`));
  }
  if (!args.peek && posts.length) {
    sw.cursors[name] = posts[posts.length - 1].seq;
    writeJson(sw.cursorsFile, sw.cursors);
  }
}

function cmdCursor(args) {
  const sw = context(args);
  const name = stripAt(args._[1]);
  if (!name) die('usage: mure cursor <@name> [--set N] [--reset]');
  if (!sw.members[name]) die(`unknown member @${name}`);
  if (args.reset) sw.cursors[name] = 0;
  else if (args.set !== undefined) sw.cursors[name] = Number(args.set);
  writeJson(sw.cursorsFile, sw.cursors);
  ok(`@${name} cursor = ${sw.cursors[name] || 0}`);
}

function cmdRunnable(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const all = runnable(sw, board);
  const list_ = all.filter((m) => memberRole(sw, m.name) !== 'coordinator');
  const coord = all.find((m) => memberRole(sw, m.name) === 'coordinator');
  if (args.json) {
    ok(JSON.stringify({
      swarm: sw.slug,
      runnable: list_.map((m) => ({ member: at(m.name), role: memberRole(sw, m.name), unread: m.posts.map((p) => p.seq) })),
      coordinatorUnread: coord ? coord.posts.map((p) => p.seq) : [],
    }, null, 2));
    return;
  }
  if (coord) ok(`coordinator: ${coord.posts.length} unread (#${coord.posts.map((p) => p.seq).join(' #')}) - that is you, read them yourself.`);
  if (!list_.length) {
    ok('nobody else is runnable: every member is waiting.');
    ok('that is a stall if the swarm is not finished. Post a reminder, or close it.');
    return;
  }
  ok(`${list_.length} runnable member(s):`);
  list_.forEach((m) => ok(`  ${pad(at(m.name), 18)} ${pad(memberRole(sw, m.name), 12)} unread ${m.posts.map((p) => `#${p.seq}`).join(' ')}`));
  if (sw.meta.maxParallel && list_.length > sw.meta.maxParallel) {
    ok('');
    ok(`throttle: ${list_.length} runnable > max-parallel ${sw.meta.maxParallel}. Dispatch ${sw.meta.maxParallel} now.`);
  }
}

function cmdStatus(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const posts = runnable(sw, board);
  if (args.json) {
    ok(JSON.stringify({
      swarm: sw.slug,
      goal: sw.meta.goal,
      closed: sw.meta.closed,
      posts: board.length,
      members: Object.keys(sw.members).map((n) => ({
        member: at(n),
        role: memberRole(sw, n),
        killed: Boolean(sw.members[n].killed),
        unread: unreadFor(sw, n, board).length,
        lastVerdict: (lastVerdict(sw, board, n) || {}).meta?.verdict || null,
      })),
      openQuestions: openQuestions(sw, board).map((q) => q.seq),
    }, null, 2));
    return;
  }
  ok(`swarm   ${sw.slug}${sw.meta.closed ? '  [CLOSED]' : ''}`);
  ok(`goal    ${truncate(sw.meta.goal || '(none)', 100)}`);
  ok(`verify  ${truncate(sw.meta.verify || '(none - the verifier must be told what to run)', 100)}`);
  ok(`board   ${board.length} post(s)   max-parallel ${sw.meta.maxParallel}`);
  ok('');
  ok(`${pad('MEMBER', 18)}${pad('ROLE', 12)}${pad('STATE', 26)}LAST`);
  Object.keys(sw.members).forEach((n) => {
    const mine = posts.find((p) => p.name === n);
    const st = statusLine(sw, n, mine ? mine.posts : [], board);
    const last = board.filter((p) => stripAt(p.from) === n).slice(-1)[0];
    ok(`${pad(at(n), 18)}${pad(memberRole(sw, n), 12)}${pad(st, 26)}${last ? `#${last.seq} ${last.kind}` : '-'}`);
  });
  const qs = openQuestions(sw, board);
  if (qs.length) {
    ok('');
    ok(`open questions (${qs.length}):`);
    qs.forEach((q) => ok(`  #${q.seq} ${at(q.from)} -> ${q.to.map(at).join(' ')}: ${truncate(q.body, 70)}`));
  }
  if (sw.meta.closed) ok('\nthis swarm is closed; reopen with: mure reopen');
}

function cmdOpen(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const qs = openQuestions(sw, board);
  if (args.json) {
    ok(JSON.stringify({ openQuestions: qs.map((q) => ({ seq: q.seq, from: at(q.from), to: q.to.map(at), body: q.body })) }, null, 2));
    return;
  }
  if (!qs.length) ok('no open question');
  else {
    ok(`${qs.length} open question(s):`);
    qs.forEach((q) => ok(`\n${renderPost(q)}`));
  }
}

function cmdBoard(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const tail = args.all ? board.length : args.tail ? Number(args.tail) : 50;
  const slice = board.slice(Math.max(0, board.length - tail));
  const hidden = board.length - slice.length;
  if (args.markdown) {
    ok(`# ${sw.slug}`);
    ok('');
    ok(`_${sw.meta.goal || ''}_`);
    ok('');
    if (hidden) ok(`_${hidden} earlier post(s) not shown (mure board --all)_\n`);
    slice.forEach((p) => {
      ok(`## #${p.seq} ${p.kind} - ${at(p.from)} -> ${p.to.map(at).join(' ')}`);
      ok('');
      ok(`${p.ts}${p.refs && p.refs.length ? `  refs ${p.refs.map((r) => `#${r}`).join(' ')}` : ''}${p.meta?.verdict ? `  verdict **${p.meta.verdict}**` : ''}`);
      ok('');
      ok(p.body);
      ok('');
    });
    return;
  }
  slice.forEach((p) => ok(`${renderPost(p)}\n`));
  if (hidden) ok(`(${hidden} earlier post(s) not shown; mure board --all)`);
}

function cmdPrompt(args) {
  const sw = context(args);
  const name = stripAt(args._[1]);
  if (!name) die('usage: mure prompt <@name> [--no-advance]');
  const m = sw.members[name];
  if (!m) die(`unknown member @${name}`);
  if (m.killed) die(`@${name} was killed; a killed member cannot be dispatched, add a new one`);
  const board = readBoard(sw);
  const posts = unreadFor(sw, name, board);
  if (!posts.length && !args.force) {
    die(`nothing unread for @${name}: there is nothing to dispatch. Post a note first, or pass --force to inspect the prompt.`);
  }
  const qs = openQuestions(sw, board).filter((q) => addressed(q, name));
  const wt = path.join(sw.worktrees, name);
  const hasWt = fs.existsSync(wt);
  const out = [];
  out.push(`# Mure dispatch - ${at(name)} (${m.role})`);
  out.push('');
  out.push(`swarm: ${sw.slug}`);
  if (sw.meta.goal) out.push(`goal: ${sw.meta.goal}`);
  out.push('');
  out.push('## Brief');
  out.push(`- owns: ${(m.owns || []).join(', ') || '(nothing declared)'}`);
  out.push(`- must not touch: ${(m.mustNot || []).join(', ') || '(nothing declared)'}`);
  out.push(`- done means: ${m.done || '(not declared)'}`);
  if (sw.meta.verify) out.push(`- verification command: \`${sw.meta.verify}\``);
  if (hasWt) out.push(`- worktree: ${wt}`);
  out.push('');
  out.push('## Rules for this turn');
  if (m.role === 'worker') {
    out.push(`1. Work only inside the files you own. Check with \`${run(sw, `scope ${at(name)}`)}\` before you stop.`);
    out.push('2. Post exactly one message before you stop: `report` when your piece is done, `question` when blocked.');
  } else if (m.role === 'verifier') {
    out.push('1. Do not modify code. Your job is to judge it, not to fix it.');
    out.push('2. Post one `verdict` per worker you checked, and a `question` only if you cannot judge.');
  } else if (m.role === 'monitor') {
    out.push('1. Do not modify anything.');
    out.push('2. Post one `stall` naming who can restart the work, or one `status` if the swarm is moving.');
  } else {
    out.push('1. Do not modify code.');
    out.push('2. Post one message: `note`, `answer`, `block`, or `done`.');
  }
  out.push('3. Post as yourself only, never as another member. Do not spawn other agents.');
  out.push('4. Then stop. The coordinator decides what happens next.');
  if (m.role === 'verifier') {
    out.push(`5. Verdict command: \`${run(sw, `verdict ${at('worker')} --verdict ${VERDICTS.join('|')} --motif "..."`)}\``);
  }
  out.push('');
  out.push('## Commands');
  out.push('```');
  out.push(run(sw, `inbox ${at(name)}`));
  out.push(run(sw, `post --from ${at(name)} --to @coordinator --kind report --body "..."`));
  out.push('```');
  out.push(`board: ${boardPathForPrompt(sw)}`);
  out.push('');
  if (posts.length) {
    out.push(`## New posts for you (${posts.length})`);
    posts.forEach((p) => {
      out.push('');
      out.push(`### #${p.seq} ${p.kind} - ${at(p.from)}${p.refs && p.refs.length ? ` (refs ${p.refs.map((r) => `#${r}`).join(' ')})` : ''}`);
      out.push(p.body);
    });
  } else {
    out.push('## New posts for you');
    out.push('');
    out.push('(none - you were woken without a new message; this is a coordinator error, post a question)');
  }
  if (qs.length) {
    out.push('');
    out.push('## Questions awaiting your answer');
    qs.forEach((q) => out.push(`- #${q.seq} from ${at(q.from)}: ${q.body}`));
  }
  out.push('');
  out.push('---');
  out.push(`When you have posted, reply to the coordinator with one line: what you did, the post number, and anything unresolved.`);
  ok(out.join('\n'));
  if (!args['no-advance']) {
    if (posts.length) {
      sw.cursors[name] = posts[posts.length - 1].seq;
      writeJson(sw.cursorsFile, sw.cursors);
    }
    const cwd = hasWt ? wt : sw.root;
    sw.state.baselines = sw.state.baselines || {};
    try {
      sw.state.baselines[name] = snapshot(cwd);
    } catch {
      warn(`could not record a baseline for @${name}; scope will cover the whole working tree`);
    }
    writeJson(sw.stateFile, sw.state);
    if (!hasWt && m.role === 'worker') {
      const others = runnable(sw, board).filter((x) => x.name !== name && memberRole(sw, x.name) === 'worker');
      if (others.length) {
        warn(`${others.length} other worker(s) also share this working tree (${others.map((x) => at(x.name)).join(', ')}).`);
        warn('their edits will count against this member in `mure scope`. Either dispatch one at a time,');
        warn('or give each worker a worktree: `mure worktree @name --create` (or init with --worktrees).');
      }
    }
  }
}

function cmdVerdict(args) {
  const sw = context(args);
  const worker = stripAt(args._[1]);
  if (!worker) die('usage: mure verdict <@worker> --verdict validated|validated-with-reserve|rejected|needs-info --motif "..." [--on <seq>] [--reserve "..."]');
  if (!sw.members[worker]) die(`unknown member @${worker}`);
  const verdict = String(args.verdict || '');
  if (!VERDICTS.includes(verdict)) die(`--verdict must be one of: ${VERDICTS.join(', ')}`);
  const motif = String(args.motif || '').trim();
  if (!motif) die('--motif is required: it is quoted in the integration note');
  if (verdict === 'validated-with-reserve' && !args.reserve) die('--reserve is required for validated-with-reserve (the reserve text goes into the note verbatim)');
  const from0 = stripAt(args.from || '');
  let from = from0;
  if (!from) {
    const verifiers = Object.keys(sw.members).filter((n) => memberRole(sw, n) === 'verifier' && !killed(sw, n));
    if (verifiers.length === 1) from = verifiers[0];
    else if (!verifiers.length) die('no verifier in this swarm; add one: mure member add "@verifier" --role verifier');
    else die(`several verifiers (${verifiers.map(at).join(' ')}); pass --from @name`);
  }
  if (!sw.members[from]) die(`unknown verifier @${from}`);
  if (memberRole(sw, from) !== 'verifier') die(`@${from} is a ${memberRole(sw, from)}; only a verifier may post a verdict`);
  const body = args.reserve ? `${motif}\n\nRESERVE (quote verbatim): ${args.reserve}` : motif;
  const refs = [];
  if (args.on) refs.push(Number(args.on));
  else {
    const last = readBoard(sw).filter((p) => stripAt(p.from) === worker && p.kind === 'report').slice(-1)[0];
    if (last) refs.push(last.seq);
  }
  const rec = appendPost(sw, { from, to: [worker], kind: 'verdict', body, refs, meta: { verdict, reserve: args.reserve ? String(args.reserve) : null } });
  ok(`#${rec.seq} verdict ${verdict} on ${at(worker)}`);
}

function changedFiles(cwd) {
  const raw = git(cwd, ['status', '--porcelain']);
  const files = [];
  raw.split('\n').filter(Boolean).forEach((line) => {
    const status = line.slice(0, 2);
    let file = line.slice(3).trim();
    if (file.includes(' -> ')) file = file.split(' -> ').pop();
    if (status.includes('D')) return;
    files.push(file.replace(/^"|"$/g, ''));
  });
  return files.filter((f) => f !== '.mure' && !f.startsWith('.mure/'));
}

function untrackedFiles(cwd) {
  try {
    return git(cwd, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function snapshot(cwd) {
  if (!isGitRepo(cwd)) return null;
  let head = null;
  try {
    head = git(cwd, ['rev-parse', 'HEAD']).trim() || null;
  } catch {
    head = null;
  }
  let stash = null;
  try {
    stash = git(cwd, ['stash', 'create']).trim() || null;
  } catch {
    stash = null;
  }
  return { head, stash, untracked: untrackedFiles(cwd), at: nowIso() };
}

function changesSince(cwd, base) {
  if (!base) return changedFiles(cwd);
  const ref = base.stash || base.head;
  const files = new Set();
  if (ref) {
    const raw = git(cwd, ['diff', '--name-status', ref]).split('\n').filter(Boolean);
    raw.forEach((line) => {
      const parts = line.split('\t');
      const status = parts[0] || '';
      const file = parts.length > 2 ? parts[2] : parts[1];
      if (!file || status.startsWith('D')) return;
      files.add(file);
    });
  }
  const before = new Set(base.untracked || []);
  untrackedFiles(cwd).filter((f) => !before.has(f)).forEach((f) => files.add(f));
  return [...files].filter((f) => f !== '.mure' && !f.startsWith('.mure/'));
}

function cmdScope(args) {
  const sw = context(args);
  const name = stripAt(args._[1]);
  if (!name) die('usage: mure scope <@name>');
  const m = sw.members[name];
  if (!m) die(`unknown member @${name}`);
  const wt = path.join(sw.worktrees, name);
  const cwd = fs.existsSync(wt) ? wt : sw.root;
  if (!isGitRepo(cwd)) die(`not a git repository: ${cwd}`);
  let files;
  const base = sw.state?.baselines?.[name] || null;
  try {
    files = base ? changesSince(cwd, base) : changedFiles(cwd);
  } catch (e) {
    die(`git status failed: ${e.message}`);
  }
  const owns = m.owns || [];
  const mustNot = m.mustNot || [];
  const violations = [];
  files.forEach((f) => {
    if (matchesAny(f, mustNot)) violations.push({ file: f, why: 'must-not-touch' });
    else if (owns.length && !matchesAny(f, owns)) violations.push({ file: f, why: 'outside owns' });
  });
  if (args.json) {
    ok(JSON.stringify({ member: at(name), worktree: cwd, baseline: base ? base.at : null, changed: files, violations }, null, 2));
  } else {
    ok(`@${name} in ${cwd}`);
    if (base) ok(`changes since dispatch ${base.at}: ${files.length ? files.join(', ') : '(nothing)'}`);
    else {
      ok(`changed in the working tree: ${files.length ? files.join(', ') : '(nothing)'}`);
      ok('note: no baseline (this member was not dispatched with `mure prompt`), so changes by other members are counted too');
    }
    if (!violations.length) ok('scope: clean');
    else {
      violations.forEach((v) => ok(`VIOLATION ${v.file} (${v.why})`));
    }
  }
  if (violations.length) process.exit(3);
}

function cmdWorktree(args) {
  const sw = context(args);
  const name = stripAt(args._[1]);
  if (!name) die('usage: mure worktree <@name> --create|--remove [--force]');
  if (!sw.members[name]) die(`unknown member @${name}`);
  if (!isGitRepo(sw.root)) die('worktrees need a git repository');
  const target = path.join(sw.worktrees, name);
  const branch = `mure/${sw.slug}/${name}`;
  if (args.remove) {
    if (!fs.existsSync(target)) die(`no worktree for @${name}`);
    if (!args.force) {
      const dirty = git(target, ['status', '--porcelain']).trim();
      if (dirty) die(`@${name} has uncommitted work; land it, or pass --force`);
    }
    try {
      git(sw.root, ['worktree', 'remove', '--force', target]);
    } catch (e) {
      warn(`git worktree remove failed: ${e.message}`);
    }
    try {
      git(sw.root, ['branch', '-D', branch]);
    } catch {
      warn(`branch ${branch} was not deleted (it may hold work)`);
    }
    ok(`worktree of ${at(name)} removed`);
    return;
  }
  if (fs.existsSync(target)) die(`worktree already exists: ${target}`);
  try {
    createWorktree(sw, name);
  } catch (e) {
    die(`git worktree add failed: ${e.message}`);
  }
  ok(`worktree ${at(name)}: ${target} (branch ${branch})`);
  ok('the next `mure prompt` records that worktree as the member baseline');
}

function cmdGraph(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const edges = new Map();
  board.forEach((p) => {
    p.to.map(stripAt).forEach((t) => {
      if (t === stripAt(p.from)) return;
      const key = `${stripAt(p.from)}\u0000${t}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    });
  });
  const nodes = Object.keys(sw.members).map((n) => {
    const role = memberRole(sw, n);
    const shape = role === 'coordinator' ? '[["' : role === 'verifier' ? '[("' : '(["';
    const close = role === 'coordinator' ? '"]]' : role === 'verifier' ? '")]' : '"])';
    return `  ${n}${shape}${at(n)}\\n${role}${close}`;
  });
  const lines = ['flowchart LR', ...nodes];
  [...edges.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => {
    const [from, to] = key.split('\u0000');
    lines.push(`  ${from} -->|${count}| ${to}`);
  });
  if (args.json) {
    ok(JSON.stringify({ nodes: Object.keys(sw.members), edges: [...edges.entries()].map(([k, v]) => ({ from: k.split('\u0000')[0], to: k.split('\u0000')[1], posts: v })) }, null, 2));
    return;
  }
  ok('```mermaid');
  ok(lines.join('\n'));
  ok('```');
}

function cmdClose(args) {
  const sw = context(args);
  if (sw.meta.closed) die(`already closed at ${sw.meta.closed}`);
  const board = readBoard(sw);
  const qs = openQuestions(sw, board);
  const blockers = [];
  if (qs.length) blockers.push(`${qs.length} question(s) still open (${qs.map((q) => `#${q.seq}`).join(', ')})`);
  const hasVerifier = Object.keys(sw.members).some((n) => memberRole(sw, n) === 'verifier' && !sw.members[n].killed);
  Object.keys(sw.members).forEach((n) => {
    const m = sw.members[n];
    if (m.role !== 'worker' || m.killed) return;
    const reported = board.some((p) => stripAt(p.from) === n && p.kind === 'report');
    if (!reported) blockers.push(`${at(n)} was given a brief but never posted a report`);
    const v = lastVerdict(sw, board, n);
    if (v && ['rejected', 'needs-info'].includes(v.meta?.verdict)) blockers.push(`${at(n)} last verdict is ${v.meta.verdict} (#${v.seq})`);
    if (reported && !v && hasVerifier) blockers.push(`${at(n)} reported but no verifier ever judged it`);
  });
  const blockingPosts = unresolvedBlocks(sw, board);
  if (blockingPosts.length) blockers.push(`${blockingPosts.length} unresolved block/stall post(s) (${blockingPosts.map((p) => `#${p.seq}`).join(', ')}); clear them with: mure resolve <seq> --body "..."`);
  Object.keys(sw.members).forEach((n) => {
    const v = lastVerdict(sw, board, n);
    if (v && ['rejected', 'needs-info'].includes(v.meta?.verdict)) blockers.push(`${at(n)} last verdict is ${v.meta.verdict} (#${v.seq})`);
  });
  if (blockers.length && !args.force) {
    process.stderr.write('mure: refusing to close, the swarm is not finished:\n');
    blockers.forEach((b) => process.stderr.write(`  - ${b}\n`));
    process.stderr.write('fix them, or pass --force to close anyway (the final report must then say what is unresolved)\n');
    process.exit(1);
  }
  const summary = args.summary ? String(args.summary) : 'swarm closed';
  appendPost(sw, { from: 'coordinator', to: Object.keys(sw.members), kind: 'done', body: summary, refs: [], meta: { forced: blockers.length > 0 } });
  sw.meta.closed = nowIso();
  writeJson(sw.metaFile, sw.meta);
  ok(`swarm "${sw.slug}" closed after ${board.length + 1} posts`);
  if (blockers.length) {
    ok('');
    ok('closed by force; still unresolved:');
    blockers.forEach((b) => ok(`  - ${b}`));
  }
  ok('');
  ok('final report to the human should state: what was verified, what was not, contradictions, and where files landed.');
}

function cmdReopen(args) {
  const sw = context(args);
  sw.meta.closed = null;
  writeJson(sw.metaFile, sw.meta);
  ok(`swarm "${sw.slug}" reopened`);
}

function cmdDoctor(args) {
  const sw = context(args);
  const board = readBoard(sw);
  const problems = [];
  const infos = [];
  let last = 0;
  board.forEach((p, i) => {
    if (p.seq !== last + 1) problems.push(`#${p.seq} at line ${i + 1}: expected seq ${last + 1}`);
    last = p.seq;
    if (!sw.members[stripAt(p.from)]) problems.push(`#${p.seq}: unknown sender ${at(p.from)}`);
    if (!KINDS.includes(p.kind)) problems.push(`#${p.seq}: unknown kind "${p.kind}"`);
    p.to.forEach((t) => {
      if (!sw.members[stripAt(t)]) problems.push(`#${p.seq}: unknown recipient ${at(t)}`);
    });
    const authorRole = memberRole(sw, p.from);
    if (p.kind === 'verdict') {
      if (authorRole !== 'verifier') problems.push(`#${p.seq}: verdict posted by ${at(p.from)} (${authorRole}), not a verifier`);
      if (!p.meta?.verdict) problems.push(`#${p.seq}: verdict without meta.verdict`);
      if (!String(p.body || '').trim()) problems.push(`#${p.seq}: verdict without a motif`);
    }
    if (p.kind === 'done' && authorRole !== 'coordinator') problems.push(`#${p.seq}: done posted by ${at(p.from)}, not the coordinator`);
    if (p.kind === 'brief' && authorRole !== 'coordinator') infos.push(`#${p.seq}: brief posted by ${at(p.from)} (${authorRole})`);
    (p.refs || []).forEach((r) => {
      if (r >= p.seq) problems.push(`#${p.seq}: ref #${r} is not earlier`);
      if (!board.some((x) => x.seq === r)) problems.push(`#${p.seq}: ref #${r} missing`);
    });
  });
  Object.values(sw.members).forEach((m) => {
    if (m.role === 'verifier' && !m.watches.length) infos.push(`verifier @${m.name} watches nobody`);
    if (m.role === 'worker' && !m.owns.length) infos.push(`worker @${m.name} owns nothing (scope cannot be checked)`);
  });
  const qs = openQuestions(sw, board);
  const blocks = unresolvedBlocks(sw, board);
  if (blocks.length) infos.push(`${blocks.length} unresolved block/stall post(s): ${blocks.map((p) => `#${p.seq}`).join(', ')}`);
  if (!sw.meta.closed && board.length > 0 && !qs.length && !runnable(sw, board).length) {
    infos.push('everyone is waiting and nothing is open: either close the swarm or post a status');
  }
  if (sw.meta.closed && board.slice(-1)[0]?.kind !== 'done') infos.push('swarm closed but the last post is not a done post');
  if (args.json) {
    ok(JSON.stringify({ swarm: sw.slug, posts: board.length, problems, infos }, null, 2));
  } else {
    ok(`swarm ${sw.slug}: ${board.length} post(s), ${Object.keys(sw.members).length} member(s)`);
    if (!problems.length) ok('board: clean');
    problems.forEach((p) => ok(`PROBLEM ${p}`));
    infos.forEach((i) => ok(`note ${i}`));
  }
  if (problems.length) process.exit(1);
}

function cmdHelp() {
  const text = [
    `mure ${VERSION} - shared board for a swarm of coding agents`,
    '',
    'usage: mure <command> [options]',
    '',
    '  init <slug> --goal "..." [--verify "npm test"] [--max-parallel N] [--worktrees]',
    '  member add <@name> --role worker|verifier|monitor [--owns globs] [--must-not globs] [--done text] [--watches @a,@b] [--model id]',
    '  member kill <@name> [--reason "..."] [--force]',
    '  members',
    '  post --from @name --to @a,@b|@all --kind <kind> [--body "..."] [--body-file f] [--stdin] [--ref N]',
    `        kinds: ${KINDS.join(', ')}`,
    '  roles: coordinator brief,report,note,answer,done,status,question,block',
    '         worker report,question,claim,answer,note,status,block',
    '         verifier verdict,question,answer,note,status,block',
    '         monitor stall,question,answer,note,status,block',
    '  answer <seq> --from @name --body "..."',
    '  resolve <seq> [--from @name] [--body "..."]   clear a block/stall post',
    '  inbox <@name> [--peek] [--json]',
    '  cursor <@name> [--set N] [--reset]',
    '  runnable [--json]',
    '  prompt <@name> [--no-advance]',
    '  verdict <@worker> --verdict validated|validated-with-reserve|rejected|needs-info --motif "..." [--reserve "..."] [--on N] [--from @verifier]',
    '  scope <@name> [--json]',
    '  worktree <@name> --create|--remove [--force]',
    '  status [--json]',
    '  open [--json]',
    '  board [--tail N] [--all] [--markdown]',
    '  graph [--json]',
    '  close [--summary "..."] [--force]',
    '  reopen',
    '  doctor [--json]',
    '',
    'global: --root <dir>  --swarm <slug>',
  ].join('\n');
  ok(text);
}

// -------------------------------------------------------------------- main

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) return cmdHelp();
  if (cmd === 'version' || cmd === '--version') return ok(VERSION);
  const table = {
    init: cmdInit,
    member: cmdMember,
    members: cmdMembers,
    post: cmdPost,
    answer: cmdAnswer,
    resolve: cmdResolve,
    inbox: cmdInbox,
    cursor: cmdCursor,
    runnable: cmdRunnable,
    status: cmdStatus,
    open: cmdOpen,
    board: cmdBoard,
    prompt: cmdPrompt,
    verdict: cmdVerdict,
    scope: cmdScope,
    worktree: cmdWorktree,
    graph: cmdGraph,
    close: cmdClose,
    reopen: cmdReopen,
    doctor: cmdDoctor,
  };
  const fn = table[cmd];
  if (!fn) die(`unknown command "${cmd}" (try: mure help)`);
  fn(args);
}

main();
