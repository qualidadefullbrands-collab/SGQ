// SGQ unified navigation: do not keep stale HTML or private API responses in offline cache.
const CACHE='sgq-shell-v3-20261026';
const APP_SHELL=['/','/index.html','/manifest.webmanifest','/sgq-icon.svg'];
self.addEventListener('install',(event)=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).catch(()=>undefined));
  self.skipWaiting();
});
self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch',(event)=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  // Supabase sessions, API calls and all external origins always use the network.
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put('/index.html',copy)).catch(()=>undefined);
      }
      return response;
    }).catch(async()=>await caches.match('/index.html')||Response.error()));
    return;
  }
  if(url.pathname.startsWith('/assets/')){
    event.respondWith(caches.match(request).then(existing=>existing||fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>undefined);
      }
      return response;
    })));
    return;
  }
  if(APP_SHELL.includes(url.pathname)){
    event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>undefined);
      }
      return response;
    }).catch(async()=>await caches.match(request)||Response.error()));
  }
});
