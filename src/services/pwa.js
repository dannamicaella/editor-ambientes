import { ref } from 'vue'

export const offlineStatus = ref(__PWA__ ? 'checking' : 'unavailable')
export const canInstall = ref(false)
let installEvent
let checkTimer

function verify() {
  const controller = navigator.serviceWorker.controller
  if (!controller) return
  clearTimeout(checkTimer)
  const channel = new MessageChannel()
  checkTimer = setTimeout(() => {
    channel.port1.close()
    offlineStatus.value = 'unavailable'
  }, 6000)
  channel.port1.onmessage = (event) => {
    clearTimeout(checkTimer)
    channel.port1.close()
    offlineStatus.value = event.data ? 'ready' : 'unavailable'
  }
  controller.postMessage('verify-cache', [channel.port2])
}

export function setupPwa() {
  if (!__PWA__) return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent = event
    canInstall.value = true
  })
  window.addEventListener('appinstalled', clearInstall)
  if (!navigator.serviceWorker) {
    offlineStatus.value = 'unavailable'
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', verify)
  window.addEventListener('focus', verify)
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI))
    .then((registration) => {
      function watchInstall() {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !navigator.serviceWorker.controller) offlineStatus.value = 'unavailable'
        })
      }
      registration.addEventListener('updatefound', watchInstall)
      watchInstall()
      verify()
    })
    .catch(() => { offlineStatus.value = 'unavailable' })
}

function clearInstall() {
  installEvent = undefined
  canInstall.value = false
}

export async function installApp() {
  if (installEvent) {
    const event = installEvent
    clearInstall()
    await event.prompt()
  }
}