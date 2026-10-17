'use strict';
// Small fetch helpers: retries with backoff, a polite pace, and an optional record/replay cache so the
// whole pipeline can be tested offline against real recorded responses.
const fs = require('fs');
const path = require('path');

function makeGetter({ base, replay, record, minGapMs = 120, headers = {} }) {
  let last = 0, calls = 0, cache = null;
  if (replay) cache = JSON.parse(fs.readFileSync(replay, 'utf8'));
  const recorded = {};
  async function get(p, { optional = false } = {}) {
    const url = p.startsWith('http') ? p : base + p;
    calls++;
    if (cache) {
      const key = p.startsWith('http') ? new URL(p).pathname + new URL(p).search : p;
      if (key in cache) return cache[key];
      if (optional) return null;
      throw new Error('not in recording: ' + key);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = last + minGapMs - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
      try {
        const res = await fetch(url, { headers: Object.assign({ 'user-agent': 'blueline-desk (github.com)', accept: 'application/json' }, headers), signal: AbortSignal.timeout(30000) }); // a stuck request is retried, not waited on
        if (res.status === 404 && optional) return null;
        if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
        if (!res.ok) { const t = await res.text(); throw Object.assign(new Error('HTTP ' + res.status + ' ' + url + ' ' + t.slice(0, 200)), { fatal: true }); }
        const body = await res.json();
        get.lastHeaders = res.headers;
        if (record) recorded[p] = body;
        return body;
      } catch (e) {
        if (e.fatal || attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
      }
    }
  }
  get.calls = () => calls;
  get.save = () => { if (record) { fs.mkdirSync(path.dirname(record), { recursive: true }); fs.writeFileSync(record, JSON.stringify(recorded)); } };
  return get;
}

module.exports = { makeGetter };
