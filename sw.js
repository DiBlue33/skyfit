/* ============================================================
   SkyFit — Service worker
   ------------------------------------------------------------
   Trois rôles :
     1. rendre le jeu installable (avec le manifeste) ;
     2. le faire démarrer sans réseau (cache de la coquille) ;
     3. recevoir les notifications push envoyées par l'émetteur
        planifié (.github/workflows/notify.yml).

   ⚠️ BUILD doit suivre le `?v=` posé sur les <script>/<link> de
   index.html, et ASSET_V doit suivre CONFIG.ASSET_V. Deux raisons :
   les URL mises en cache ici portent ces tampons (sinon on
   précharge des fichiers que la page ne demandera jamais), et
   changer BUILD est ce qui fait *voir* au navigateur un nouveau
   service worker — donc ce qui déclenche la purge des vieux
   caches. Un test de non-régression vérifie les deux.
   ============================================================ */

const BUILD    = '20260802g';
const ASSET_V  = '20260728b';
const CACHE    = 'skyfit-' + BUILD;

const JS = [
  'config', 'routes', 'skills', 'state', 'engine', 'scene', 'sky', 'ui',
  'stats', 'weekly', 'streak', 'weather', 'weather-ui', 'map', 'worlddata',
  'achievements', 'wheel', 'profile', 'quests', 'sync-config', 'sync',
  'auth', 'pwa', 'main',
];

const PLANES = [
  'cessna', 'cessna_prop', 'tbm700', 'a220', 'b737', 'a320',
  'falcon900', 'a330', 'a380', 'concorde',
];

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=' + BUILD,
  ...JS.map(n => './js/' + n + '.js?v=' + BUILD),
  ...PLANES.map(n => './assets/planes/' + n + '.png?v=' + ASSET_V),
  './assets/icons/creatine.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/avatars/diego.png',
  './assets/avatars/jade.png',
];

/* ---------- Installation : on précharge la coquille ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll() est tout-ou-rien : un seul 404 (une photo d'avatar retirée,
    // par exemple) ferait échouer l'installation entière et le jeu
    // resterait sans service worker. On préfère les requêtes une à une.
    await Promise.all(CORE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
    ));
    self.skipWaiting();
  })());
});

/* ---------- Activation : purge des versions précédentes ---------- */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('skyfit-') && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ---------- Lecture : réseau d'abord pour les pages, cache d'abord
     pour le reste. Les fichiers versionnés (?v=) ne changent jamais
     sous une même URL : les servir depuis le cache est sûr et
     instantané. La page, elle, n'a pas de tampon — c'est elle qui
     annonce la nouvelle version, donc elle passe par le réseau. ---------- */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Tout ce qui n'est pas sur notre origine part au réseau sans détour :
  // Firebase et les prévisions météo ne doivent JAMAIS être servis
  // depuis un cache, sinon les deux pilotes se désynchronisent.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreVary: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      return Response.error();
    }
  })());
});

/* ---------- Notifications ---------- */

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  const title = d.title || 'SkyFit';
  const options = {
    body: d.body || '',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    // Un `tag` par famille d'alerte : une nouvelle alerte « altitude »
    // remplace la précédente au lieu d'empiler dix bannières identiques
    // après quelques heures hors ligne.
    tag: d.tag || 'skyfit',
    renotify: true,
    data: { url: d.url || './' },
    lang: 'fr',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    // Si le jeu est déjà ouvert quelque part, on le ramène au premier plan
    // plutôt que d'ouvrir une seconde fenêtre.
    for (const w of wins) {
      if (w.url.indexOf(self.registration.scope) === 0 && 'focus' in w) {
        return w.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
