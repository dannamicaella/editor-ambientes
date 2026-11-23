import { containsPrompt } from './mobileSamGeometry.js'

export function createMobileSam(image, preferred = 'auto') {
  const base = new URL('ai/', document.baseURI).href
  let worker
  let waiting
  let timer
  let initialized = false
  let region
  let fullImage = false
  let closed = false
  let request = 0
  let provider = "wasm"

  function terminate() {
    worker?.terminate()
    worker = undefined
    initialized = false
  }

  function finish(error, result) {
    if (!waiting) return
    const { resolve, reject } = waiting
    waiting = undefined
    clearTimeout(timer)
    if (error) reject(error)
    else resolve(result)
  }

  function watchdog(ms, message) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      terminate()
      finish(new Error(message))
    }, ms)
  }

  function start() {
    worker = new Worker(new URL('./mobileSam.worker.js', import.meta.url), { type: 'module' })
    const instance = worker
    worker.onmessage = ({ data }) => {
      if (instance !== worker || data.request !== request || !waiting) return
      if (data.progress) {
        const { step } = data.progress
        watchdog(step === 'download' ? 45_000 : 90_000, 'A IA demorou demais neste dispositivo.')
        waiting.progress(data.progress)
      } else if (data.error) {
        if (data.stage === 'prediction' && data.error.startsWith('O modelo não encontrou')) initialized = true
        finish(new Error(data.error))
      } else {
        initialized = true
        region = data.result.region
        finish(null, data.result)
      }
    }
    worker.onerror = (event) => {
      if (instance === worker) finish(new Error(event.message || 'O navegador não conseguiu iniciar o processamento local da IA.'))
    }
    worker.onmessageerror = () => {
      if (instance === worker) finish(new Error('Não foi possível ler a resposta da IA local.'))
    }
  }

  async function attempt(points, box, progress, previous) {
    let bitmap
    try {
      if (!initialized) bitmap = await createImageBitmap(image)
      if (closed) throw new DOMException('Segmentação cancelada.', 'AbortError')
      if (!worker) start()
      return await new Promise((resolve, reject) => {
        waiting = { resolve, reject, progress }
        watchdog(45_000, 'A IA demorou demais para iniciar.')
        try {
          const sameRegion = initialized && previous?.region && ['x', 'y', 'width', 'height']
            .every((key) => previous.region[key] === region[key])
          const feedback = sameRegion ? { raw: previous.raw, logits: previous.logits } : undefined
          worker.postMessage({
            request: ++request, points, box, bitmap, base, provider, fullImage, previous: feedback, refining: !!previous,
          }, bitmap ? [bitmap] : [])
          bitmap = undefined
        } catch (error) {
          finish(error)
        }
      })
    } finally {
      bitmap?.close()
    }
  }

  async function predict(points, box, progress = () => {}, previous) {
    if (closed) throw new DOMException('Segmentação cancelada.', 'AbortError')
    const prompts = points.map(({ x, y, type }) => ({ x, y, type }))
    if (region && prompts.some((point) => point.type === 'positive' && !containsPrompt(region, point))) {
      fullImage = true
      terminate()
    }
    try {
      return await attempt(prompts, box, progress, previous)
    } catch (error) {
      if (closed || error.message.startsWith('O modelo não encontrou')) throw error
      if (preferred === 'auto' && provider === 'webgpu') {
        terminate()
        provider = 'wasm'
        progress({ step: 'fallback' })
        try {
          return await attempt(prompts, box, progress, previous)
        } catch (fallbackError) {
          terminate()
          throw fallbackError
        }
      }
      terminate()
      throw error
    }
  }

  function dispose() {
    closed = true
    terminate()
    finish(new DOMException('Segmentação cancelada.', 'AbortError'))
  }

  return { predict, dispose }
}

export async function verifyAiCache(assets) {
  const controller = navigator.serviceWorker?.controller
  if (!controller) return false
  for (let attempt = 0; attempt < 4; attempt++) {
    const ready = await new Promise((resolve) => {
      const channel = new MessageChannel()
      function done(value) {
        clearTimeout(timer)
        channel.port1.close()
        resolve(value)
      }
      const timer = setTimeout(() => done(false), 1500)
      channel.port1.onmessage = ({ data }) => done(data === true)
      controller.postMessage({ type: 'verify-ai', assets }, [channel.port2])
    })
    if (ready) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
