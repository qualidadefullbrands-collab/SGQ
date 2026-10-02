const CACHE='sgq-shell-v1';
const APP_SHELL=['/','/index.html','/manifest.webmanifest','/sgq-icon.svg'];
self.addEventListener('install',(event)=>{
  event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(APP_SHELL)).catch(()=>undefined));
  self.skipWaiting();
});
self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((k)=>k!==CACHE).map((k)=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',(event)=>{
  if(event.request.method!=='GET') return;
  event.respondWith(fetch(event.request).then((res)=>{
    const clone=res.clone();
    caches.open(CACHE).then((cache)=>cache.put(event.request,clone)).catch(()=>undefined);
    return res;
  }).catch(()=>caches.match(event.request).then((cached)=>cached || caches.match('/index.html'))));
});