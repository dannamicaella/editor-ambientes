import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:4178'
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const executablePath = process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined)
const original = process.argv.includes('--original')
const inputPath = resolve(original ? 'test-fixtures/almofada-peixes.jpeg' : 'test-fixtures/mobilesam-sala-cc0.jpg')
const output = resolve(original ? '.tmp/mobilesam-acceptance' : '.tmp/mobilesam-benchmark')
const artifacts = await readdir('dist-pwa/assets')
const workerPath = '/assets/' + artifacts.find((file) => /^mobileSam\.worker-.*\.js$/.test(file))
const photoPath = '/benchmark-input.jpeg'
if (!existsSync(inputPath)) throw new Error('Foto de benchmark indisponível em ' + inputPath)
const geometry = await readFile('src/services/mobileSamGeometry.js', 'utf8')
await mkdir(output, { recursive: true })
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--mode', 'pwa',
  '--host', '127.0.0.1', '--port', '4178', '--strictPort'], { stdio: 'inherit' })

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('A prévia encerrou antes do teste.')
    if (await fetch(origin + '/ai/runtime.json', { signal: AbortSignal.timeout(2000) })
      .then((response) => response.headers.get('content-type')?.includes('application/json')).catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('A prévia não iniciou.')
}

async function benchmark(name, backend, args) {
  const browser = await chromium.launch({ executablePath, args })
  try {
    const page = await browser.newPage()
    await page.route(origin + '/benchmark', (route) => route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8">' }))
    await page.route(origin + '/benchmark-geometry.js', (route) => route.fulfill({ contentType: 'text/javascript', body: geometry }))
    await page.route(origin + photoPath, (route) => route.fulfill({ path: inputPath, contentType: 'image/jpeg' }))
    await page.goto(origin + '/benchmark')
    const result = await page.evaluate(async ({ backend, workerPath, photoPath, original }) => {
      const { samAlpha, samLogitAt } = await import('/benchmark-geometry.js')
      const image = await globalThis.createImageBitmap(await (await fetch(photoPath)).blob())
      const normalized = (x, y, type) => ({ x: x / image.width, y: y / image.height, type })
      const positive = normalized(...(original ? [430, 936] : [289, 791]), 'positive')
      const negatives = (original
        ? [[460, 550], [830, 960], [475, 1320], [26, 840], [161, 1320], [784, 1178]]
        : [[267, 742], [314, 748], [212, 787], [286, 823], [304, 843]])
        .map(([x, y]) => normalized(x, y, 'negative'))
      const [left, top, right, bottom] = original ? [4, 523, 850, 1370] : [184, 730, 380, 854]
      const box = { ...normalized(left, top), right: right / image.width, bottom: bottom / image.height }
      const adapter = backend === 'webgpu' ? await navigator.gpu?.requestAdapter() : null
      const adapterInfo = adapter && {
        vendor: adapter.info?.vendor, architecture: adapter.info?.architecture,
        device: adapter.info?.device, description: adapter.info?.description, fallback: adapter.info?.isFallbackAdapter,
      }
      const worker = new globalThis.Worker(workerPath, { type: 'module' })
      let request = 0
      async function predict(points, previous) {
        const bitmap = request ? undefined : await globalThis.createImageBitmap(image)
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('A inferência excedeu 120 s.')), 120_000)
          function finish(error, result) {
            clearTimeout(timeout)
            if (error) reject(error)
            else resolve(result)
          }
          worker.onmessage = ({ data }) => {
            if (data.error) finish(new Error(data.error))
            else if (data.result) finish(null, data.result)
          }
          worker.onerror = ({ message }) => finish(new Error(message || 'Falha ao iniciar o Worker.'))
          worker.postMessage({
            request: ++request, points, box, bitmap, base: globalThis.location.origin + '/ai/', provider: backend,
            refining: !!previous, previous: previous && { raw: previous.raw, logits: previous.logits },
          }, bitmap ? [bitmap] : [])
        })
      }
      function summarize(result) {
        const { startupMs, encodingMs, decodingMs } = result
        return { startupMs, encodingMs, decodingMs }
      }
      try {
        const first = await predict([positive])
        const second = await predict([positive, ...negatives], first)
        const guideOnly = original ? await predict([]) : undefined
        const boundaryCorrection = original ? await predict([positive, negatives.at(-1)], first) : undefined
        const [cropX, cropY, cropWidth, cropHeight] = original ? [0, 510, 900, 875] : [166, 720, 240, 172]
        const previewWidth = original ? 540 : 240
        const previewHeight = Math.round(cropHeight * previewWidth / cropWidth)
        const panel = globalThis.document.createElement('canvas')
        panel.width = previewWidth * 2
        panel.height = previewHeight
        const context = panel.getContext('2d')
        context.fillStyle = '#263745'
        context.fillRect(0, 0, panel.width, panel.height)
        context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, previewWidth, previewHeight)
        function render(result) {
          const crop = globalThis.document.createElement('canvas')
          crop.width = cropWidth
          crop.height = cropHeight
          const pixels = crop.getContext('2d')
          const raster = samAlpha(result.logits, result.side, result.imageSize, image, result.region)
          const rows = Math.max(1, Math.floor(256_000 / raster.width))
          for (let y = 0; y < raster.height; y += rows) {
            const band = pixels.createImageData(raster.width, Math.min(rows, raster.height - y))
            raster.writeAlpha(band.data, y)
            pixels.putImageData(band, raster.x - cropX, raster.y - cropY + y)
          }
          pixels.globalCompositeOperation = 'source-in'
          pixels.drawImage(image, -cropX, -cropY)
          return crop
        }
        const crop = render(second)
        const pixels = crop.getContext('2d')
        const alpha = (x, y) => pixels.getImageData(x - cropX, y - cropY, 1, 1).data[3]
        const samples = original ? {
          peixeSuperior: alpha(619, 726), peixeCentral: alpha(490, 866), peixeInferior: alpha(601, 1054),
          tecido: alpha(430, 945), palhaAcima: alpha(460, 550), palhaDireita: alpha(830, 960),
          palhaAbaixo: alpha(475, 1320), palhaEsquerda: alpha(26, 840), palhaJuntoABorda: alpha(784, 1178),
        } : {
          almofada: alpha(289, 791), cadeira: alpha(267, 742), assento: alpha(304, 843),
          almofadaVizinha: alpha(168, 802),
        }
        const initialInterior = original ? [[619, 726], [490, 866], [601, 1054], [430, 945]].map(([x, y]) => {
          return samLogitAt(first.logits, first.side, first.imageSize, {
            x: (x / image.width - first.region.x) / first.region.width,
            y: (y / image.height - first.region.y) / first.region.height,
          }) > 0
        }) : undefined
        function previewData(result) {
          return result && render(result).toDataURL().split(',')[1]
        }
        context.drawImage(crop, previewWidth, 0, previewWidth, previewHeight)
        return { initial: summarize(first), correction: summarize(second), adapter: adapterInfo, initialInterior, samples,
          initialCandidates: first.diagnostics, correctionCandidates: second.diagnostics, guideOnlyCandidates: guideOnly?.diagnostics,
          initialCutout: original ? previewData(first) : undefined, guideCutout: previewData(guideOnly),
          boundaryCutout: previewData(boundaryCorrection),
          preview: panel.toDataURL().split(',')[1], cutout: original ? crop.toDataURL().split(',')[1] : undefined }
      } catch (error) {
        return { error: error.message, adapter: adapterInfo }
      } finally {
        worker.terminate()
        image.close()
      }
    }, { backend, workerPath, photoPath, original })
    const { preview, cutout, initialCutout, guideCutout, boundaryCutout, ...metrics } = result
    if (preview) await writeFile(resolve(output, name + '.png'), Buffer.from(preview, 'base64'))
    if (cutout) await writeFile(resolve(output, name + '-recorte.png'), Buffer.from(cutout, 'base64'))
    if (initialCutout) await writeFile(resolve(output, name + '-inicial.png'), Buffer.from(initialCutout, 'base64'))
    if (guideCutout) await writeFile(resolve(output, name + '-guia.png'), Buffer.from(guideCutout, 'base64'))
    if (boundaryCutout) await writeFile(resolve(output, name + '-uma-correcao.png'), Buffer.from(boundaryCutout, 'base64'))
    return { name, ...metrics }
  } finally {
    await browser.close()
  }
}

try {
  await ready()
  const measurements = []
  for (const [name, backend, args] of [
    ['wasm', 'wasm', []],
    ['webgpu', 'webgpu', []],
    ['webgpu-software', 'webgpu', ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']],
  ]) {
    if (name === 'webgpu-software' && measurements.some((item) => item.name === 'webgpu' && item.initial)) break
    const item = await benchmark(name, backend, args).catch((error) => ({ name, error: error.message }))
    measurements.push(item)
    console.log(JSON.stringify(item))
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(measurements, null, 2) + '\n')
  const completed = measurements.filter(({ initial }) => initial)
  if (!completed.length) process.exitCode = 1
  if (original && completed.some(({ initialInterior, samples }) =>
    !initialInterior.every(Boolean) || Object.entries(samples).some(([sample, alpha]) =>
      alpha !== (sample.startsWith('palha') ? 0 : 255)))) {
    console.error('O benchmark da foto original detectou perda da estampa ou palha sem transparência.')
    process.exitCode = 1
  }
} finally {
  child.kill()
}
