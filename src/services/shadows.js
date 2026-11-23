import { context2d, createCanvas, releaseImage } from './images.js'
import { fitSize } from '../utils/geometry.js'

const cache = new WeakMap()
const MAX_RASTER = 384
const MAX_ENTRIES = 2

function rasterize(bitmap, size, radius, color, contact) {
  const { width, height } = size
  const pad = Math.ceil(radius * 3) + 1
  const castHeight = contact ? Math.max(1, Math.ceil(height * 0.10)) : height
  const cast = createCanvas(width, castHeight)
  const mask = context2d(cast)
  const start = contact ? Math.floor(bitmap.height * 0.72) : 0
  mask.imageSmoothingQuality = 'high'
  mask.drawImage(bitmap, 0, start, bitmap.width, bitmap.height - start, 0, 0, width, castHeight)
  mask.globalCompositeOperation = 'source-in'
  mask.fillStyle = color
  mask.fillRect(0, 0, width, castHeight)

  const canvas = createCanvas(width + pad * 2, castHeight + pad * 2)
  const context = context2d(canvas)
  if (radius) context.filter = 'blur(' + radius + 'px)'
  context.drawImage(cast, pad, pad)
  releaseImage(cast)
  return { canvas, pad, castHeight }
}

function shadowRaster(bitmap, size, radius, color, contact) {
  let entries = cache.get(bitmap)
  if (!entries) {
    entries = new Map()
    cache.set(bitmap, entries)
  }
  const key = [size.width, size.height, radius, color, contact].join('/')
  let value = entries.get(key)
  if (value) entries.delete(key)
  else value = rasterize(bitmap, size, radius, color, contact)
  entries.set(key, value)
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    releaseImage(entries.get(oldest).canvas)
    entries.delete(oldest)
  }
  return value
}

export function releaseShadows(bitmap) {
  const entries = cache.get(bitmap)
  if (entries) for (const { canvas } of entries.values()) releaseImage(canvas)
  cache.delete(bitmap)
}

export function drawShadows(context, bitmap, asset, width, height, settings) {
  const dimensions = asset.bounds
  // Preview and export use the same size relative to the object's original silhouette.
  const size = fitSize(dimensions.width, dimensions.height, MAX_RASTER)
  const edge = Math.max(width, height)
  const rasterEdge = Math.max(size.width, size.height)
  const scaleX = width / size.width
  const scaleY = height / size.height
  const opacity = context.globalAlpha
  const dx = settings.x * edge / 100
  const dy = settings.y * edge / 100

  function cast(strength, radius, contact) {
    if (!strength) return
    const { canvas, pad, castHeight } = shadowRaster(bitmap, size, radius, settings.color, contact)
    context.globalAlpha = opacity * strength / 100
    const x = -width / 2 + dx - pad * scaleX
    const y = (contact ? height / 2 - castHeight * scaleY / 2 : -height / 2) + dy - pad * scaleY
    context.drawImage(canvas, x, y, canvas.width * scaleX, canvas.height * scaleY)
  }
  cast(settings.opacity, Math.round(rasterEdge * settings.blur / 100), false)
  cast(settings.contact, Math.max(0.8, Math.min(rasterEdge * 0.011, size.height * 0.06)), true)
  context.globalAlpha = opacity
}
