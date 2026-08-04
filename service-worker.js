// service-worker.js — mise en cache de l'application pour un fonctionnement 100% hors ligne.

const CACHE_NOM = 'cellules-entrepot-v1';

const FICHIERS_A_METTRE_EN_CACHE = [
  './',
  './index.html',
  './style.css',
  './utils.js',
  './db.js',
  './search.js',
  './import.js',
  './export.js',
  './ui.js',
  './app.js',
  './manifest.json',
  './lib/xlsx.full.min.js',
  './lib/Sortable.min.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NOM).then((cache) => cache.addAll(FICHIERS_A_METTRE_EN_CACHE))
  );
  // Pas de self.skipWaiting() ici : la nouvelle version reste "en attente"
  // tant que la page ne demande pas explicitement à l'activer (bouton "Mettre à jour").
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NOM).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Déclenché par app.js quand l'utilisateur clique sur "Mettre à jour"
self.addEventListener('message', (evt) => {
  if (evt.data === 'SKIP_WAITING') self.skipWaiting();
});

// Stratégie "cache d'abord" : tout l'essentiel est déjà en cache après la première visite
self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then((reponse) => reponse || fetch(evt.request))
  );
});
