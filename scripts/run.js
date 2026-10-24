#!/usr/bin/env node
/**
 * One-command launcher (no dependencies of its own).
 *
 *   node scripts/run.js setup   install backend + frontend dependencies
 *   node scripts/run.js dev     start MongoDB (only if none is running), backend and frontend together
 */
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const useShell = process.platform === 'win32';

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error(`Node.js 18.17+ is required (you have ${process.versions.node}).`); process.exit(1); }

function install(dir, label) {
  if (fs.existsSync(path.join(dir, 'node_modules', '.package-lock.json'))) return;
  console.log(`\n> Installing ${label} dependencies...`);
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: useShell });
  if (r.status !== 0) { console.error(`npm install failed in ${label}.`); process.exit(r.status || 1); }
}

const readEnv = file => Object.fromEntries((fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split(/\r?\n/)
  .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

function ensureEnv() {
  const envFile = path.join(BACKEND, '.env');
  if (!fs.existsSync(envFile)) {
    const secret = require('crypto').randomBytes(48).toString('hex');
    const example = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf8');
    fs.writeFileSync(envFile, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
    console.log('> Created backend/.env with a fresh SESSION_SECRET');
  }
  const frontEnv = path.join(FRONTEND, '.env');
  if (!fs.existsSync(frontEnv)) fs.copyFileSync(path.join(FRONTEND, '.env.example'), frontEnv);
}

const canConnect = (host, port) => new Promise(resolve => {
  const s = net.connect({ host, port, timeout: 1500 });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('timeout', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(false));
});

const children = [];
function run(name, color, cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: useShell && cmd === npm });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = stream => stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => console.log(tag + l)));
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', code => { console.log(`${tag}exited (${code})`); if (name !== 'db') shutdown(code || 0); });
  children.push(child);
  return child;
}
function shutdown(code = 0) {
  children.forEach(c => { try { c.kill(); } catch (e) { /* already gone */ } });
  setTimeout(() => process.exit(code), 500);
}
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(0)));

async function waitFor(port, label, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await canConnect('127.0.0.1', port)) return true; await new Promise(r => setTimeout(r, 700)); }
  console.error(`Timed out waiting for ${label} on port ${port}.`); return false;
}

async function main() {
  const mode = process.argv[2] || 'dev';
  install(BACKEND, 'backend');
  install(FRONTEND, 'frontend');
  ensureEnv();
  if (mode === 'setup') { console.log('\n✔ Setup complete. Start everything with: npm run dev'); return; }

  const be = readEnv(path.join(BACKEND, '.env'));
  const fe = readEnv(path.join(FRONTEND, '.env'));
  const uri = be.MONGODB_URI || 'mongodb://127.0.0.1:27017/attendx';
  const m = /^mongodb:\/\/(?:[^@/]+@)?([^/:,]+)(?::(\d+))?/.exec(uri);
  const local = m && ['127.0.0.1', 'localhost'].includes(m[1]);
  const dbPort = m && m[2] ? Number(m[2]) : 27017;

  if (local && !(await canConnect('127.0.0.1', dbPort))) {
    console.log(`\n> No MongoDB on port ${dbPort}: starting a local development database (first run downloads MongoDB once, ~100 MB)...`);
    run('db', '33', process.execPath, [path.join('scripts', 'dev-db.js')], BACKEND);
    if (!(await waitFor(dbPort, 'MongoDB'))) return shutdown(1);
  } else if (!local) {
    console.log(`\n> Using MongoDB from MONGODB_URI (${m ? m[1] : 'remote'}).`);
  } else {
    console.log(`\n> MongoDB already running on port ${dbPort}.`);
  }

  run('backend', '36', process.execPath, [path.join('src', 'server.js')], BACKEND);
  if (!(await waitFor(Number(be.PORT || 3000), 'the backend', 60000))) return shutdown(1);

  // Seed demo data once, on a brand-new database, so there is always a working login.
  const seed = spawnSync(process.execPath, [path.join('scripts', 'seed-demo.js'), '--simple'], { cwd: BACKEND, encoding: 'utf8' });
  if (/password for ALL demo users/.test(seed.stdout || '')) console.log('\n> Demo data created:\n' + seed.stdout);

  run('frontend', '35', process.execPath, ['server.js'], FRONTEND);
  const webPort = fe.PORT || 5173;
  if (await waitFor(Number(webPort), 'the frontend', 30000)) {
    console.log(`\n\x1b[32m✔ AttendX is running -> http://localhost:${webPort}\x1b[0m`);
    console.log('  College code GEC24   |   hod@gec.edu / Passw0rd1   (also r.mathur@gec.edu, aditya.sharma@student.gec.edu)');
    console.log('  Press Ctrl+C to stop everything.\n');
  }
}
main().catch(e => { console.error(e); shutdown(1); });
