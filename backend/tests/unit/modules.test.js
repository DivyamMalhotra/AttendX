const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, '..', 'frontend');
const PUBLIC = path.join(FRONTEND, 'public');

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return e.name.endsWith(ext) ? [full] : [];
  });
}

/** Static import graph: file -> [resolved file]. Only relative specifiers are followed. */
function graph(files, pattern) {
  const g = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const deps = [];
    for (const m of src.matchAll(pattern)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), spec);
      const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
      const hit = candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
      deps.push({ spec, hit });
    }
    g.set(file, deps);
  }
  return g;
}

function findCycle(g) {
  const state = new Map();
  const stack = [];
  const visit = node => {
    state.set(node, 1); stack.push(node);
    for (const { hit } of g.get(node) || []) {
      if (!hit || !g.has(hit)) continue;
      if (state.get(hit) === 1) return [...stack.slice(stack.indexOf(hit)), hit];
      if (!state.get(hit)) { const c = visit(hit); if (c) return c; }
    }
    stack.pop(); state.set(node, 2);
    return null;
  };
  for (const n of g.keys()) { if (!state.get(n)) { const c = visit(n); if (c) return c; } }
  return null;
}

const rel = f => path.relative(ROOT, f);

test('backend: every relative require resolves and there are no circular dependencies', () => {
  const files = [...walk(path.join(ROOT, 'src'), '.js'), ...walk(path.join(ROOT, 'scripts'), '.js')];
  const g = graph(files, /require\(\s*['"]([^'"]+)['"]\s*\)/g);
  const broken = [...g].flatMap(([f, deps]) => deps.filter(d => !d.hit).map(d => `${rel(f)} -> ${d.spec}`));
  assert.deepEqual(broken, [], 'unresolved requires');
  const cycle = findCycle(g);
  assert.equal(cycle, null, cycle && `circular dependency: ${cycle.map(rel).join(' -> ')}`);
});

test('backend: every module loads without starting a server (server.js excluded)', () => {
  const mods = walk(path.join(ROOT, 'src'), '.js').filter(f => !f.endsWith('server.js'));
  const script = `process.env.NODE_ENV='test';process.env.SESSION_SECRET='x'.repeat(40);${mods.map(m => `require(${JSON.stringify(m)});`).join('')}console.log('ok')`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT }).toString().trim();
  assert.equal(out, 'ok');
});

test('frontend: every ES module import resolves, with no circular imports', () => {
  const files = walk(path.join(PUBLIC, 'js'), '.js');
  const g = graph(files, /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g);
  const broken = [...g].flatMap(([f, deps]) => deps.filter(d => !d.hit).map(d => `${rel(f)} -> ${d.spec}`));
  assert.deepEqual(broken, []);
  const cycle = findCycle(g);
  assert.equal(cycle, null, cycle && `circular import: ${cycle.map(rel).join(' -> ')}`);
});

test('frontend: lazy page routes point at files that exist and export a default render function', () => {
  const pages = path.join(PUBLIC, 'js', 'pages');
  for (const role of ['student', 'teacher', 'hod', 'parent']) {
    const main = fs.readFileSync(path.join(pages, role, 'main.js'), 'utf8');
    const loads = [...main.matchAll(/page\('([^']+)'\)|\['[\w-]+', '([\w]+\.js)'\]|import\('\.\/(\w+\.js)'\)|'([\w]+\.js)', \[/g)].map(m => m[1] || m[2] || m[3] || m[4]);
    assert.ok(loads.length >= 2, role);
    for (const file of loads) {
      const full = path.join(pages, role, file);
      assert.ok(fs.existsSync(full), `${role}/${file} is missing`);
      assert.match(fs.readFileSync(full, 'utf8'), /export default (async )?function/, `${role}/${file} needs a default render export`);
    }
  }
});

test('frontend: all scripts parse as ES modules', () => {
  const files = walk(path.join(PUBLIC, 'js'), '.js');
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'attendx-esm-'));
  try {
    files.forEach((f, i) => {
      // `node --check` decides the module type from the extension, so check an .mjs copy
      const copy = path.join(tmp, `${i}.mjs`);
      fs.copyFileSync(f, copy);
      try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); }
      catch (e) { assert.fail(`${rel(f)} does not parse: ${e.stderr}`); }
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('HTML pages reference only files that exist and contain no inline scripts', () => {
  for (const page of fs.readdirSync(path.join(PUBLIC)).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), `${page} has an inline script (blocked by the CSP)`);
    for (const m of html.matchAll(/(?:src|href)="((?!https?:|#|mailto:)[^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(PUBLIC, m[1])), `${page} references missing ${m[1]}`);
    }
  }
});

test('css entry imports only files that exist', () => {
  const dir = path.join(PUBLIC, 'css');
  const main = fs.readFileSync(path.join(dir, 'main.css'), 'utf8');
  for (const m of main.matchAll(/@import url\('([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), m[1]);
});

test('frontend html helper escapes user data (XSS safe) and mounts arrays of fragments', async () => {
  const { html, raw, esc } = await import(require('node:url').pathToFileURL(path.join(PUBLIC, 'js', 'utils', 'dom.js')).href);
  const evil = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(String(html`<b>${evil}</b>`), `<b>${esc(evil)}</b>`);
  assert.ok(!String(html`<td title="${evil}">x</td>`).includes('<img'));
  assert.equal(String(html`${[html`<i>${'a<b>'}</i>`, 'c&d']}`), '<i>a&lt;b&gt;</i>c&amp;d');
  assert.equal(String(html`${raw('<hr>')}${false}${null}${undefined}`), '<hr>');
  const el = { innerHTML: '' };
  const { mount } = await import(require('node:url').pathToFileURL(path.join(PUBLIC, 'js', 'utils', 'dom.js')).href);
  mount(el, [html`<tr>${evil}</tr>`, html`<tr>2</tr>`]);
  assert.ok(el.innerHTML.startsWith('<tr>&lt;img') && el.innerHTML.endsWith('<tr>2</tr>'));
});

test('the bundled stylesheet is up to date with its source files (run npm run build:css in frontend/)', () => {
  const { bundle } = require('../../../frontend/scripts/build-css');
  assert.equal(fs.readFileSync(path.join(PUBLIC, 'css', 'app.css'), 'utf8'), bundle());
});
