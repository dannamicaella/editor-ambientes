const prefix = 'ambientes:' + self.registration.scope + ':'
const version = prefix + '__VERSION__'
const aiVersion = prefix + 'ai:' + '__AI_VERSION__'
const files = ['__FILES__']
const aiFiles = ['__AI_FILES__']
const urls = files.map((file) => new URL(file, self.registration.scope).href)
const known = new Set(urls)
const knownAi = new Set(aiFiles.map((file) => new URL(file, self.registration.scope).href))
const entry = new URL('index.html', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(async function () {
    const cache = await caches.open(version)
    try {
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })))
    } catch (error) {
      await caches.delete(version)
      throw error
    }
  }())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(async function () {
    await Promise.all((await caches.keys()).filter((key) =>
      key.startsWith(prefix) && key !== version && key !== aiVersion).map((key) => caches.delete(key)))
    await self.clients.claim()
  }())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return
  const url = request.mode === 'navigate' ? entry : request.url
  if (knownAi.has(url)) {
    const cache = caches.open(aiVersion).catch(() => null)
    const result = cache.then(async (storage) => {
      const existing = await storage?.match(url).catch(() => null)
      if (existing) return { response: existing }
      const response = await fetch(request)
      return { response, copy: storage && response.ok ? response.clone() : null }
    })
    event.respondWith(result.then(({ response }) => response))
    event.waitUntil(result.then(async ({ copy }) => {
      if (copy) await (await cache)?.put(url, copy)
    }).catch(() => {}))
    return
  }
  if (!known.has(url)) return
  event.respondWith(async function () {
    const cache = await caches.open(version)
    const cached = await cache.match(url)
    if (cached) return cached
    const response = await fetch(url)
    if (response.ok) await cache.put(url, response.clone()).catch(() => {})
    return response
  }())
})

self.addEventListener('message', (event) => {
  if (!event.ports[0]) return
  const verifyAi = event.data?.type === 'verify-ai'
  if (event.data !== 'verify-cache' && !verifyAi) return
  event.waitUntil(async function () {
    let ready = false
    try {
      const cache = await caches.open(verifyAi ? aiVersion : version)
      const entries = new Set((await cache.keys()).map((request) => request.url))
      ready = verifyAi
        ? Array.isArray(event.data.assets) && event.data.assets.length > 0 &&
          event.data.assets.every((url) => knownAi.has(url) && entries.has(url))
        : urls.every((url) => entries.has(url))
    } finally {
      event.ports[0].postMessage(ready)
    }
  }())
})
