// Mesa de Pensamento: abre rápido e funciona sem internet.
// Página: tenta a rede primeiro (até 3 s) para já pegar a versão nova; sem rede, usa o cache.
// Outros arquivos: devolve do cache e atualiza em segundo plano.
var CACHE = 'mesa-4b04636db8';
var FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('mesa-') === 0 && k !== CACHE && k !== 'mesa-share'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(req, key, c) {
  return fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok) c.put(key, res.clone());
    return res;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  // "Compartilhar > Mesa" (Android): guarda o texto e abre a Mesa com ele.
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async function () {
      var text = '';
      try {
        var fd = await req.formData();
        text = [fd.get('title'), fd.get('text'), fd.get('url')].filter(Boolean).join('\n');
        var files = fd.getAll('files');
        for (var i = 0; i < files.length; i++) { if (files[i] && files[i].text) text += (text ? '\n' : '') + await files[i].text(); }
      } catch (err) {}
      var c = await caches.open('mesa-share');
      await c.put('./__shared', new Response(text, { headers: { 'content-type': 'text/plain;charset=utf-8' } }));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // chamadas às IAs passam direto
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(function (c) {
      var net = fromNetwork(req, './index.html', c);
      var timeout = new Promise(function (res) { setTimeout(res, 3000); });
      return Promise.race([net.catch(function () { return null; }), timeout]).then(function (res) {
        if (res) return res;
        return c.match('./index.html').then(function (hit) { return hit || net; });
      });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fromNetwork(req, req, c).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
