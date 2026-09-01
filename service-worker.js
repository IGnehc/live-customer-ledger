const CACHE='live-ledger-v5';
const STATIC=['./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  const u=new URL(req.url);
  if(u.origin!==location.origin){ event.respondWith(fetch(req)); return; }
  if(req.mode==='navigate' || u.pathname.endsWith('/index.html') || u.pathname.endsWith('/cloud-sync.js')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(r=>r||fetch(req)));
});
