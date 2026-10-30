/**
 * 每日营养管家 PWA Service Worker
 * - 导航请求：网络优先，离线回退缓存首页
 * - 静态资源（js/css/图片/manifest/图标）：缓存优先，后台更新
 * - /api/*：始终走网络（AI 结果不缓存）
 * - 版本升级：安装新 SW 后清理旧缓存并立即接管
 */
const CACHE_NAME = "nutrition-tracker-v3.5.0-1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon-180.png"
];
const STATIC_EXT = /\.(?:js|css|json|webmanifest|png|jpe?g|webp|svg|ico|woff2?)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put("/index.html", fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const shell = await cache.match("/index.html", { ignoreSearch: true });
    if (shell) return shell;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // 先精确匹配（带 ?v= 版本号），保证发版后能拿到新 CSS/JS
  const exact = await cache.match(request);
  if (exact) {
    fetch(request).then((res) => { if (res && res.ok) cache.put(request, res.clone()); }).catch(() => {});
    return exact;
  }
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    // 离线时退回忽略版本号的旧缓存
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // AI 接口不缓存

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(cacheFirst(request).catch(() => caches.match(request, { ignoreSearch: true })));
  }
});