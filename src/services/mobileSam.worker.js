import { containsPrompt, FULL_IMAGE, guidedRegion, modelPrompts, relativePrompts, resizedImage, SAM_SIZE, selectMask } from './mobileSamGeometry.js'

let ort
let encoder
let decoder
let embedding
let imageSize
let region
let backend
let encodingMs
let startupMs
let assets

function publish(request, data) {
  self.postMessage({ request, ...data })
}

function absolute(path, base) {
  return new URL(path, base).href
}

async function manifest(path, base) {
  const response = await fetch(absolute(path, base))
  if (!response.ok) throw new Error('Os arquivos da IA estão indisponíveis. Conecte-se para baixar o modelo ou use o recorte manual.')
  return response.json()
}

async function download(asset, base, progress) {
  const bytes = new Uint8Array(asset.bytes)
  let received = 0
  for (const part of asset.parts ?? [asset]) {
    const response = await fetch(absolute(part.path, base))
    if (!response.ok) throw new Error('O download da IA falhou. Verifique a conexão ou use o recorte manual.')
    const reader = response.body.getReader()
    const end = received + part.bytes
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (received + value.length > end) throw new Error('O arquivo da IA tem um tamanho inesperado.')
        bytes.set(value, received)
        received += value.length
        progress(value.length)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (received !== end) throw new Error('O arquivo da IA está incompleto. Tente novamente com conexão.')
  }
  if (asset.sha256) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const hex = Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('')
    if (hex !== asset.sha256) throw new Error('O arquivo do modelo não passou na verificação de integridade.')
  }
  return bytes
}

async function initialize({ request, base, provider }) {
  const start = performance.now()
  if (provider === 'webgpu' && !await self.navigator.gpu?.requestAdapter()) {
    throw new Error('O WebGPU não está disponível neste navegador ou dispositivo.')
  }
  const [runtime, model] = await Promise.all([
    manifest('runtime.json', base), manifest('mobilesam-v1/manifest.json', base),
  ])
  const profile = runtime.profiles[provider]
  const modelAssets = ['encoder.onnx', 'decoder.onnx'].map((name) => ({
    ...model.files[name], path: 'mobilesam-v1/' + name,
    parts: model.files[name].parts?.map((part) => ({ ...part, path: 'mobilesam-v1/' + part.name })),
  }))
  const [encoderAsset, decoderAsset] = modelAssets
  const total = profile.binary.bytes + encoderAsset.bytes + decoderAsset.bytes
  let loaded = 0
  let reported = -1
  function progress(increment) {
    loaded += increment
    const percent = Math.floor(100 * loaded / total)
    if (percent !== reported) publish(request, { progress: { step: 'download', loaded, total } })
    reported = percent
  }
  progress(0)
  const entry = absolute(profile.module.path, base)
  ort = await import(/* @vite-ignore */ entry)
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 1, 4) : 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = { mjs: absolute(profile.glue.path, base), wasm: absolute(profile.binary.path, base) }
  ort.env.wasm.wasmBinary = await download(profile.binary, base, progress)

  const options = { executionProviders: [provider], graphOptimizationLevel: 'all' }
  encoder = await ort.InferenceSession.create(await download(encoderAsset, base, progress), options)
  decoder = await ort.InferenceSession.create(await download(decoderAsset, base, progress), options)
  ort.env.wasm.wasmBinary = undefined
  startupMs = Math.round(performance.now() - start)
  backend = provider
  assets = ['runtime.json', 'mobilesam-v1/manifest.json', ...modelAssets.flatMap((asset) => (asset.parts ?? [asset]).map(({ path }) => path)),
    profile.module.path, profile.glue.path, profile.binary.path].map((path) => absolute(path, base))
}

async function encode({ request, bitmap, box, points, fullImage }) {
  publish(request, { progress: { step: 'encode' } })
  region = fullImage ? FULL_IMAGE : guidedRegion(bitmap.width, bitmap.height, box)
  if (points.some((point) => point.type === 'positive' && !containsPrompt(region, point))) region = FULL_IMAGE
  const sourceWidth = Math.round(bitmap.width * region.width)
  const sourceHeight = Math.round(bitmap.height * region.height)
  imageSize = resizedImage(sourceWidth, sourceHeight)
  const { width, height } = imageSize
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Este dispositivo não conseguiu preparar a foto para a IA.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, Math.round(bitmap.width * region.x), Math.round(bitmap.height * region.y),
    sourceWidth, sourceHeight, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  canvas.width = canvas.height = 1
  const plane = SAM_SIZE * SAM_SIZE
  const input = new Float32Array(3 * plane)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = y * SAM_SIZE + x
      const offset = (y * width + x) * 4
      input[target] = (data[offset] - 123.675) / 58.395
      input[plane + target] = (data[offset + 1] - 116.28) / 57.12
      input[plane * 2 + target] = (data[offset + 2] - 103.53) / 57.375
    }
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, SAM_SIZE, SAM_SIZE])
  try {
    const start = performance.now()
    const result = await encoder.run({ image: tensor })
    encodingMs = Math.round(performance.now() - start)
    embedding = result.image_embeddings
    await encoder.release()
    encoder = undefined
  } finally {
    tensor.dispose()
  }
}

async function predict({ request, points: rawPoints, box: rawBox, previous, refining }) {
  publish(request, { progress: { step: 'decode' } })
  const { points, box } = relativePrompts(rawPoints, rawBox, region)
  const { coordinates, labels } = modelPrompts(points, box, imageSize)
  const coords = new ort.Tensor('float32', coordinates, [1, labels.length, 2])
  const types = new ort.Tensor('float32', labels, [1, labels.length])
  const prior = new ort.Tensor('float32', previous?.raw ?? new Float32Array(256 * 256), [1, 1, 256, 256])
  const present = new ort.Tensor('float32', Float32Array.of(previous ? 1 : 0), [1])
  const correction = refining && containsPrompt(region, rawPoints.at(-1) ?? { x: -1, y: -1 })
  const feeds = { image_embeddings: embedding, point_coords: coords, point_labels: types, mask_input: prior, has_mask_input: present }

  async function candidate() {
    const result = await decoder.run(feeds)
    try {
      const side = result.masks.dims.at(-1)
      return { ...selectMask(result.masks.data, result.scores.data, side, points, box, imageSize,
        previous?.logits, correction, correction ? points.length - 1 : undefined), side }
    } finally {
      for (const tensor of Object.values(result)) tensor.dispose()
    }
  }

  try {
    const start = performance.now()
    let selection = await candidate()
    if (previous && !selection.correctionSatisfied) {
      present.data[0] = 0
      const alternate = await candidate()
      if (alternate.score > selection.score) selection = alternate
    }
    const decodingMs = Math.round(performance.now() - start)
    const { logits, raw, side, correctionSatisfied } = selection
    self.postMessage({ request, result: { logits, raw, side, correctionSatisfied, imageSize, region, assets, backend, startupMs, encodingMs, decodingMs } },
      [logits.buffer, raw.buffer])
  } finally {
    coords.dispose()
    types.dispose()
    prior.dispose()
    present.dispose()
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.bitmap) {
      await initialize(data)
      await encode(data)
    }
    await predict(data)
  } catch (error) {
    publish(data.request, { error: error.message, stage: embedding ? 'prediction' : 'initialization' })
  } finally {
    data.bitmap?.close()
  }
}
