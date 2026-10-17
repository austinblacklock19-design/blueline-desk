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
