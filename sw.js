const CACHE_NAME = "hourly-data-tool-v72";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./engine.js",
  "./image-ocr.js",
  "./tou-data.js",
  "./tou-template.js",
  "./tou-analysis.js",
  "./jszip.min.js",
  "./pdf.worker.min.js",
  "./pdf.min.js",
  "./pdf-bill.js",
  "./ocr/tesseract.min.js",
  "./ocr/worker.min.js",
  "./ocr/tesseract-core-lstm.wasm.js",
  "./ocr/eng.traineddata",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});
