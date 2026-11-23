import { context2d, createCanvas, decodeImage, encodeCanvas, releaseImage } from './images.js'
import { drawLayer } from './composition.js'
import { releaseShadows } from './shadows.js'
import { layerBox } from '../composables/projectModel.js'
import { fitSize } from '../utils/geometry.js'

export function exportChoices(background) {
  const { width, height } = background
  const largest = fitSize(width, height, 4096, 12_000_000)
  const choices = [{ id: 'large', label: largest.width === width && largest.height === height ? 'Original' : 'Máxima segura', ...largest }]
  const compact = fitSize(width, height, 1920, 3_200_000)
  if (compact.width < largest.width || compact.height < largest.height) {
    choices.push({ id: 'compact', label: 'Compacta', ...compact })
  }
  return choices
}

export async function renderExport(project, assets, size, type = 'image/png', quality = 0.92) {
  const canvas = createCanvas(size.width, size.height)
  let image
  try {
    const context = context2d(canvas)
    context.imageSmoothingQuality = 'high'
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
    }
    image = await decodeImage(assets.get(project.backgroundId).blob, size)
    context.drawImage(image, 0, 0, size.width, size.height)
    releaseImage(image)
    image = undefined
    const frame = { x: 0, y: 0, ...size }
    for (const layer of project.layers) {
      if (!layer.opacity) continue
      const asset = assets.get(layer.assetId)
      const box = layerBox(layer, asset, frame)
      const required = fitSize(asset.bounds.width, asset.bounds.height, Math.ceil(Math.max(box.width, box.height) * 1.25))
      image = await decodeImage(asset.cutout, required)
      drawLayer(context, image, asset, layer, frame)
      releaseShadows(image)
      releaseImage(image)
      image = undefined
    }
    return await encodeCanvas(canvas, type, quality)
  } finally {
    releaseShadows(image)
    releaseImage(image)
    releaseImage(canvas)
  }
}

export function fileName(name, format) {
  const safe = Array.from(name.trim(), (character) => character.charCodeAt(0) < 32 ? '-' : character).join('')
  const stem = safe.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/, '').slice(0, 96)
  return (stem || 'montagem') + (format === 'image/png' ? '.png' : '.jpg')
}

export function downloadImage(file) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
