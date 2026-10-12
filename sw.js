const VERSION = 'stcp-go-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(VERSION).then(c=>c.put(event.request,cp));}return r;}).catch(()=>caches.match(event.request)));
});
