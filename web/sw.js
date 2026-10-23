'use strict';
// Blueline Desk service worker: lets the installed app open instantly and work offline with the last data.
// scripts/build-site.js fills in the build id and the list of app files.
//   app files (versioned URLs): cache first
//   the page itself and data/feed.json: network first, cached copy when offline
//   headshot sheets and web fonts: cached copy right away, refreshed in the background
const BUILD = '__BUILD__';
const APP_FILES = __APP_FILES__;
const SHELL = 'bl-shell-' + BUILD, DATA = 'bl-data', MEDIA = 'bl-media';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('bl-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(fallbackKey || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackKey || req, { ignoreSearch: true }) || await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // the chat (POST) always goes straight to the network
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, './')); return; }
    if (path === 'data/feed.json') { e.respondWith(networkFirst(req, DATA, 'data/feed.json')); return; }
    if (path.startsWith('p/') && path.endsWith('.webp')) { e.respondWith(staleWhileRevalidate(req, MEDIA)); return; }
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && url.search) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); } // versioned files never change
      return res;
    })));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(staleWhileRevalidate(req, MEDIA));
});
