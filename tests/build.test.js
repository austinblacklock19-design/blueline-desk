'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

test('site and artifact builds produce valid scripts', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-site.js')]);
  const app = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');
  assert.doesNotThrow(() => new Function(app));
  for (const f of ['index.html', 'style.css', 'config.js', 'chat-provider.js', 'model/team.js', 'model/props.js', 'p/heads.js', 'p/COL.webp', 'data/feed.json']) assert.ok(fs.existsSync(path.join(ROOT, 'site', f)), f);
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-artifact.js')]);
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'blueline.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.strictEqual(scripts.length, 4);
  for (const s of scripts) assert.doesNotThrow(() => new Function(s));
});

test('the site installs as a phone app: manifest, icons and an offline worker that covers every app file', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-site.js')]);
  const SITE = path.join(ROOT, 'site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  const man = JSON.parse(fs.readFileSync(path.join(SITE, 'manifest.webmanifest'), 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color']) assert.ok(man[k], 'manifest ' + k);
  assert.strictEqual(man.display, 'standalone');
  const png = f => { const b = fs.readFileSync(path.join(SITE, f)); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  for (const ic of man.icons) { const [w, h] = png(ic.src); assert.strictEqual(`${w}x${h}`, ic.sizes, ic.src); }
  assert.ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512'), 'Chrome needs 192 and 512 icons');
  assert.ok(man.icons.some(i => i.purpose === 'maskable'), 'Android maskable icon');
  assert.deepStrictEqual(png('icons/apple-touch-icon.png'), [180, 180]);
  const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
  assert.doesNotThrow(() => new Function(sw));
  assert.ok(!/__BUILD__|__APP_FILES__/.test(sw), 'placeholders filled');
  const files = JSON.parse(sw.match(/const APP_FILES = (\[.*?\]);/)[1]);
  for (const f of files) assert.ok(fs.existsSync(path.join(SITE, f === './' ? 'index.html' : f.split('?')[0])), 'pre-cached file exists: ' + f);
  for (const m of html.matchAll(/(?:href|src)="([^":]+\?v=[^"]+)"/g)) assert.ok(files.includes(m[1]), 'page file is pre-cached: ' + m[1]);
  // the Claude artifact build stays free of it (no service workers there)
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-artifact.js')]);
  assert.ok(!/rel="manifest"/.test(fs.readFileSync(path.join(ROOT, 'dist', 'blueline.html'), 'utf8')));
});
