// What the host serves (web/vercel.json, web/.vercelignore): the headers a <meta> tag cannot set are there, and the folders that are not part of the page are not uploaded
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const ignored = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split('\n').map((s) => s.trim());

test('every response carries the security headers a meta tag cannot set', () => {
  const rule = config.headers.find((h) => h.source === '/(.*)');
  assert.ok(rule, 'a rule for every path');
  const header = Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.match(header['strict-transport-security'], /max-age=\d{7,}/);
  assert.equal(header['x-content-type-options'], 'nosniff');
  assert.equal(header['referrer-policy'], 'no-referrer');
  assert.equal(header['x-frame-options'], 'DENY');
  assert.match(header['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(header['permissions-policy'], /camera=\(\)/);
});

test('only the page itself is built into the folder that is served: the index, the icons and src, and nothing else', () => {
  assert.equal(config.outputDirectory, 'dist');
  const files = config.buildCommand.match(/cp -R (.+) dist\//)[1].split(' ').sort();
  assert.deepEqual(files, ['apple-touch-icon.png', 'favicon.svg', 'index.html', 'models', 'src']);
});

test('the galleries, the tools, the tests and the scripts are not uploaded', () => {
  for (const name of ['mock', 'tools', 'test', 'scripts']) assert.ok(ignored.includes(name), `${name} is left out`);
});

test('the icon is defined: a traffic signal as an SVG for the tab, and a 180 px PNG for a phone\'s home screen, both linked from the page and both uploaded', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /<link rel="icon" type="image\/svg\+xml" sizes="any" href="favicon\.svg">/);
  assert.match(page, /<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon\.png">/);
  const svg = readFileSync(new URL('../favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /<svg [^>]*viewBox="0 0 64 64"/);
  assert.equal((svg.match(/<circle /g) || []).length >= 3, true, 'three lamps');
  const png = readFileSync(new URL('../apple-touch-icon.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180);
  for (const name of ['favicon.svg', 'apple-touch-icon.png']) assert.ok(!ignored.includes(name), `${name} is uploaded`);
});

test('Vercel Web Analytics and Speed Insights are added by the page itself, from its own address, and not on localhost', () => {
  const boot = readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');
  assert.match(boot, /'\/_vercel\/insights\/script\.js'/);
  assert.match(boot, /'\/_vercel\/speed-insights\/script\.js'/);
  assert.match(boot, /\['localhost', '127\.0\.0\.1'/);
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/<script[^>]*src="https?:\/\/(?!cdn\.jsdelivr\.net)/.test(page), 'no script from another host');
});

test('the code is cached for an hour and the model for a day, and the page itself is always checked', () => {
  const rule = (source) => Object.fromEntries((config.headers.find((h) => h.source === source) || { headers: [] }).headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(rule('/src/(.*)')['cache-control'], 'public, max-age=3600');
  assert.equal(rule('/models/(.*)')['cache-control'], 'public, max-age=86400');
  assert.equal(rule('/(.*)')['cache-control'], undefined, 'index.html keeps the host default, so a new version of the page is picked up at once');
});
