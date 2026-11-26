// The page's Content-Security-Policy allows the import map by its hash, and the import map pins every file of Three.js that the page loads. If someone edits the import map and
// forgets the hash, the page stops loading, and these tests say why before a browser does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);

test('the Content-Security-Policy names the import map by its hash and allows nothing broad', () => {
  assert.ok(map && csp, 'the page has an import map and a policy');
  const hash = createHash('sha256').update(map[1]).digest('base64');
  assert.match(csp[1], new RegExp(`script-src [^;]*'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`), 'the import map hash is allowed');
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", ' * ', 'data: ']) assert.ok(!/script-src[^;]*/.exec(csp[1])[0].includes(bad), `script-src has ${bad}`);
  assert.match(csp[1], /default-src 'none'/);
  assert.match(csp[1], /connect-src 'self' https:\/\/api\.open-meteo\.com https:\/\/cdn\.jsdelivr\.net(;|$)/); // the weather, and the detector's runtime when the visitor switches camera detection on
  assert.match(csp[1], /script-src [^;]*'wasm-unsafe-eval'/, 'WebAssembly may compile, for the detector'); assert.ok(!/'unsafe-eval'/.test(csp[1]), 'but nothing may eval');
});

test('every file of Three.js that the code imports is pinned by a hash in the import map', () => {
  const { imports, integrity } = JSON.parse(map[1]);
  const used = new Set();
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.js')) for (const m of readFileSync(path, 'utf8').matchAll(/from '(three(?:\/addons\/[^']+)?)'/g)) used.add(m[1]); } };
  walk(new URL('../src', import.meta.url).pathname);
  assert.ok(used.has('three') && used.size > 1);
  for (const spec of used) {
    const url = spec === 'three' ? imports.three : imports['three/addons/'] + spec.slice('three/addons/'.length);
    assert.match(integrity[url] || '', /^sha384-[A-Za-z0-9+/]{64}$/, `${spec} is pinned`);
  }
});
