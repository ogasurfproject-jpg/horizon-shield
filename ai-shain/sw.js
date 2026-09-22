// kill-switch service worker (2026-09-22)
// 目的: 旧版が登録した Service Worker と、そのキャッシュを全部消し、
// 開いているページを網から読み直させる。以後 index.html は SW を登録せんので、二度と居座らん。
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).then(function(){
      return self.registration.unregister();
    }).then(function(){
      return self.clients.matchAll({ type: 'window' });
    }).then(function(clients){
      clients.forEach(function(c){ try { c.navigate(c.url); } catch(e){} });
    })
  );
});
