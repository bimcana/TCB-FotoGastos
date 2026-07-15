const VERSION = 'fase1-v1';
const PRECACHE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/camera.js', 'src/detect.js', 'src/cvready.js',
  'src/process.js', 'src/naming.js', 'src/settings.js', 'src/drive.js', 'src/queue.js',
  'vendor/opencv.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return; // API de Google va directo a red
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
