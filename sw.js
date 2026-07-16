const VERSION = 'fase2c2-v1';
// Los binarios de vendor/tesseract/ NO se precachean (varios MB): se cachean al usarse.
const PRECACHE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/camera.js', 'src/detect.js', 'src/cvready.js',
  'src/process.js', 'src/enhance.js', 'src/naming.js', 'src/settings.js', 'src/drive.js', 'src/queue.js',
  'src/gemini.js', 'src/validacion.js', 'src/indice.js', 'src/ocrlocal.js', 'src/importar.js', 'src/revision.js',
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
  // Los binarios de Tesseract (grandes, no precacheados) se cachean al usarse por primera
  // vez, para que el OCR local funcione después sin conexión.
  if (e.request.url.includes('/vendor/tesseract/')){
    e.respondWith(caches.open(VERSION).then(cache =>
      cache.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      }))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
