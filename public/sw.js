const CACHE_NAME = 'trackzenpro-v1';
const urlsToCache = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

// Instalar service worker e cachear arquivos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache).catch(err => {
        console.log('Cache parcial:', err);
      });
    })
  );
  self.skipWaiting();
});

// Ativar e limpar caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Interceptar requisições - network first para API, cache first para assets
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) {
    // API sempre busca do servidor
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })));
  } else {
    // Assets: tenta cache, senão busca da rede
    event.respondWith(
      caches.match(event.request).then(response => response || fetch(event.request))
    );
  }
});

// ===== NOTIFICAÇÕES PUSH =====
self.addEventListener('push', event => {
  let data = { title: 'TrackZen Pro', body: 'Nova notificação', icon: '/icons/icon-192.png' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: data,
      actions: [
        { action: 'open', title: 'Ver dashboard' },
        { action: 'close', title: 'Fechar' }
      ],
      tag: 'trackzen-notification',
      renotify: true
    })
  );
});

// Clique na notificação — abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// Notificação em background (quando app está fechado)
self.addEventListener('sync', event => {
  if (event.tag === 'check-sales') {
    event.waitUntil(checkNewSales());
  }
});

async function checkNewSales() {
  try {
    const response = await fetch('/api/dashboard/summary');
    if (response.ok) {
      const data = await response.json();
      if (data.count > 0) {
        await self.registration.showNotification('TrackZen Pro', {
          body: `${data.count} vendas hoje — R$ ${data.revenue?.toFixed(2)}`,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        });
      }
    }
  } catch {}
}
