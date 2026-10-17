#!/usr/bin/env node
'use strict';
// Builds the single-file Claude artifact version into dist/ (inline styles and scripts; headshot sheets and
// feed.json are published next to it as separate files).
//   node scripts/build-artifact.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });
const app = read('web/app.js').replace('/*PROPS*/', () => read('web/props-ui.js')).replace('/*CHAT*/', () => read('web/chat.js'));
let html = read('web/artifact-shell.html')
  .replace('/*CSS*/', () => read('web/style.css'))
  .replace('/*MODEL*/', () => read('model/team.js'))
  .replace('/*PROPSMODEL*/', () => read('model/props.js'))
  .replace('/*HEADS*/', () => read('web/p/index.json'))
  .replace('/*APP*/', () => app);
for (const ph of ['/*CSS*/', '/*MODEL*/', '/*PROPSMODEL*/', '/*HEADS*/', '/*APP*/', '/*PROPS*/', '/*CHAT*/']) if (html.includes(ph)) throw new Error('placeholder left: ' + ph);
fs.writeFileSync(path.join(OUT, 'blueline.html'), html);
for (const f of fs.readdirSync(path.join(ROOT, 'web', 'p'))) if (f.endsWith('.webp')) fs.copyFileSync(path.join(ROOT, 'web', 'p', f), path.join(OUT, 'p', f));
fs.copyFileSync(path.join(ROOT, 'data', 'feed.json'), path.join(OUT, 'feed.json'));
console.log('dist/blueline.html', html.length, 'bytes');
