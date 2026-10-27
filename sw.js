/* Service worker «Дія»: версійний кеш оболонки + керування оновленнями.
   Єдине джерело версії — файл version.json (поле build). Змінили build у репозиторії —
   застосунок побачить нову версію, повідомить користувача і за кнопкою «Оновити»
   очистить старий кеш та завантажить свіжі HTML/CSS/JS. */
/* App shell protocol revision: 1.3.11 (build 24) */
'use strict';

var SHELL_PREFIX = 'diia-shell-';
var META = 'diia-meta';
var ICON = 'https://i.postimg.cc/J0NbVkQK/IMG-0269.jpg';
var ASSETS = ['./', './index.html'];
var FONT_ASSETS = [
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-Ukraine-Regular.otf',
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-Ukraine-Medium.otf',
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-Ukraine-Bold.otf',
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-UkraineHead-Regular.otf',
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-UkraineHead-Medium.otf',
  'https://cdn.jsdelivr.net/gh/bennetfabian/e-Ukraine@main/e-UkraineHead-Bold.otf'
];
var EXTERNAL = ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'].concat(FONT_ASSETS);
var SYNC_TAG = 'diia-update-check';

function loadVersion() {
  return fetch('./version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('version http ' + r.status);
    return r.json();
  }).then(function (v) {
    if (!v || !isFinite(Number(v.build))) throw new Error('bad version');
    v.build = Number(v.build);
    return v;
  });
}

function readVersion() {
  return caches.match('./version.json').then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
}

function bust(u, build) { return u + (u.indexOf('?') < 0 ? '?' : '&') + '_=' + build + '.' + Date.now(); }

/* Завантажує свіжу оболонку в новий кеш (в обхід HTTP-кешу) і лише потім видаляє старі кеші */
function precache() {
  return loadVersion().then(function (v) {
    var name = SHELL_PREFIX + v.build;
    return caches.open(name).then(function (c) {
      var jobs = ASSETS.map(function (u) {
        return fetch(new Request(bust(u, v.build), { cache: 'reload' })).then(function (r) {
          if (!r.ok) throw new Error('asset ' + u);
          return c.put(u, r);
        });
      });
      return Promise.all(jobs).then(function () {
        /* зовнішні ресурси — за можливості, без збою всього оновлення */
        return Promise.all(EXTERNAL.map(function (u) {
          /* Шрифти запитуються в CORS-режимі, щоб кешовані відповіді працювали офлайн. */
          var mode = FONT_ASSETS.indexOf(u) !== -1 ? 'cors' : 'no-cors';
          return fetch(new Request(u, { mode: mode, cache: 'reload' })).then(function (r) {
            if (mode === 'cors' && !r.ok) throw new Error('external asset ' + u);
            return c.put(u, r);
          }).catch(function () {});
        }));
      }).then(function () {
        return c.put('./version.json', new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }));
      });
    }).then(function () {
      return caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== name && k !== META; }).map(function (k) { return caches.delete(k); }));
      });
    }).then(function () { return v; });
  });
}

function setFlag(k, val) {
  return caches.open(META).then(function (c) { return c.put('/__flag/' + k, new Response(String(val))); });
}
function getFlag(k) {
  return caches.open(META).then(function (c) { return c.match('/__flag/' + k); }).then(function (r) { return r ? r.text() : ''; }).catch(function () { return ''; });
}

self.addEventListener('install', function (e) {
  e.waitUntil(precache().catch(function () { /* офлайн під час встановлення — працюємо через мережу */ }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      /* залишаємо лише найновіший кеш оболонки */
      var shells = keys.filter(function (k) { return k.indexOf(SHELL_PREFIX) === 0; }).sort(function (a, b) {
        return Number(a.slice(SHELL_PREFIX.length)) - Number(b.slice(SHELL_PREFIX.length));
      });
      shells.pop();
      return Promise.all(shells.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (url.origin === self.location.origin) {
    /* версію та sw.js завжди беремо з мережі */
    if (/\/(version\.json|sw\.js)$/.test(url.pathname)) return;
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (h) { return h || fetch(req); });
        }
        return fetch(req);
      })
    );
    return;
  }
  if (EXTERNAL.indexOf(req.url) !== -1) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
  }
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  function reply(m) { try { if (port) port.postMessage(m); else if (e.source) e.source.postMessage(m); } catch (err) {} }

  if (d.type === 'GET_VERSION') {
    e.waitUntil(readVersion().then(function (v) { reply({ ok: !!v, version: v }); }));
  } else if (d.type === 'REFRESH') {
    e.waitUntil(precache().then(function (v) { reply({ ok: true, version: v }); }, function (err) { reply({ ok: false, error: String(err && err.message || err) }); }));
  } else if (d.type === 'SET_NOTIF') {
    e.waitUntil(setFlag('notif', d.on ? '1' : '0'));
  } else if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* Фонова перевірка (Chrome/Android для встановленого PWA): сповіщення, навіть коли застосунок закритий */
self.addEventListener('periodicsync', function (e) {
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(
    Promise.all([readVersion(), loadVersion(), getFlag('notif'), getFlag('notified')]).then(function (r) {
      var cur = r[0], remote = r[1];
      if (!cur || !remote || remote.build <= cur.build) return;
      if (r[2] !== '1' || r[3] === String(remote.build)) return;
      return setFlag('notified', remote.build).then(function () {
        return self.registration.showNotification('Дія', {
          body: 'Доступне оновлення застосунку ' + (remote.version || ''),
          icon: ICON, tag: 'diia-update'
        });
      });
    }).catch(function () {})
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
