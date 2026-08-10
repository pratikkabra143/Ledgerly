const CACHE_NAME = 'ledgerly-v1';
const ASSETS_TO_CACHE = [
    '/css/style.css',
    '/js/shared.js',
    '/js/auth.js',
    '/js/invoice.js',
    '/js/inventory.js',
    '/js/country-codes.js',
    '/icon.png'
];

// Install event: cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event: Network-first approach for APIs, Cache-first for static assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Don't cache API requests, always go to network
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
        return; 
    }

    // For HTML, CSS, JS, etc. -> Stale-while-revalidate or Network-first
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Fetch in background to update cache
                    fetch(event.request).then(response => {
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                    }).catch(() => {});
                    return cachedResponse;
                }
                
                return fetch(event.request).then(response => {
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, responseToCache));
                    return response;
                });
            })
    );
});
