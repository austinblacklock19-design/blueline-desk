#!/usr/bin/env node
'use strict';
// Builds the static site into site/ (what GitHub Pages serves) from web/, model/ and data/.
//   node scripts/build-site.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'site');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const build = Date.now().toString(36);
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['', 'model', 'p', 'data']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const app = read('web/app.js').replace('/*PROPS*/', () => read('web/props-ui.js')).replace('/*CHAT*/', () => read('web/chat.js'));
if (app.includes('/*PROPS*/') || app.includes('/*CHAT*/')) throw new Error('app.js placeholders not replaced');
fs.writeFileSync(path.join(OUT, 'app.js'), app);
fs.writeFileSync(path.join(OUT, 'index.html'), read('web/index.html').replace(/__BUILD__/g, () => build));
for (const f of ['style.css', 'config.js', 'chat-provider.js']) fs.copyFileSync(path.join(WEB, f), path.join(OUT, f));
for (const f of ['team.js', 'props.js']) fs.copyFileSync(path.join(ROOT, 'model', f), path.join(OUT, 'model', f));
for (const f of fs.readdirSync(path.join(WEB, 'p'))) fs.copyFileSync(path.join(WEB, 'p', f), path.join(OUT, 'p', f));
fs.copyFileSync(path.join(ROOT, 'data', 'feed.json'), path.join(OUT, 'data', 'feed.json'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
const size = fs.readdirSync(OUT, { recursive: true }).filter(f => fs.statSync(path.join(OUT, f)).isFile()).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log('site/ built:', (size / 1e6).toFixed(2), 'MB, build', build);
