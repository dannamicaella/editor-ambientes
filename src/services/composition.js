import { layerBox } from '../composables/projectModel.js'
import { shadowSettings } from '../composables/shadowModel.js'
import { context2d, createCanvas, decodeImage, releaseImage } from './images.js'
import { drawShadows, releaseShadows } from './shadows.js'
import { fitSize } from '../utils/geometry.js'

export function drawLayer(context, bitmap, asset, layer, frame, deviceRatio = 1) {
  const { centerX, centerY, width, height } = layerBox(layer, asset, frame)
  context.save()
  context.translate(centerX, centerY)
  context.rotate(layer.rotation * Math.PI / 180)
  context.globalAlpha = layer.opacity
  if (layer.shadow === true) {
    const effect = Math.max(width, height) * deviceRatio
    context.shadowColor = '#12191065'
    context.shadowBlur = effect * 0.045
    context.shadowOffsetY = effect * 0.038
  } else if (layer.shadow?.enabled) {
    drawShadows(context, bitmap, asset, width, height, shadowSettings(layer.shadow))
  }
  context.drawImage(bitmap, -width / 2, -height / 2, width, height)
  context.restore()
}

export function hitLayer(point, layer, asset, frame, hitMap) {
  const box = layerBox(layer, asset, frame)
  const angle = -layer.rotation * Math.PI / 180
  const x = point.x - box.centerX
  const y = point.y - box.centerY
  const localX = (Math.cos(angle) * x - Math.sin(angle) * y) / box.width + 0.5
  const localY = (Math.sin(angle) * x + Math.cos(angle) * y) / box.height + 0.5
  if (localX < 0 || localX >= 1 || localY < 0 || localY >= 1) return false
  if (!hitMap) return true
  const pixel = Math.floor(localY * hitMap.height) * hitMap.width + Math.floor(localX * hitMap.width)
  return hitMap.data[pixel * 4 + 3] > 18
}

export function selectionGeometry(layer, asset, frame) {
  const box = layerBox(layer, asset, frame)
  const angle = layer.rotation * Math.PI / 180
  const point = (x, y) => ({
    x: box.centerX + x * Math.cos(angle) - y * Math.sin(angle),
    y: box.centerY + x * Math.sin(angle) + y * Math.cos(angle),
  })
  const w = box.width / 2
  const h = box.height / 2
  return {
    ...box,
    corners: [point(-w, -h), point(w, -h), point(w, h), point(-w, h)],
    stem: point(0, -h),
    rotate: point(0, -h - 30),
  }
}

export function drawSelection(context, handles) {
  context.save()
  context.lineWidth = 4
  context.strokeStyle = '#193e32'
  context.beginPath()
  handles.corners.forEach(({x, y}, index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
  context.closePath()
  context.moveTo(handles.stem.x, handles.stem.y)
  context.lineTo(handles.rotate.x, handles.rotate.y)
  context.stroke()
  context.lineWidth = 2
  context.strokeStyle = '#f3ffd2'
  context.stroke()
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#193e32'
  for (const handle of [...handles.corners, handles.rotate]) {
    context.beginPath()
    context.arc(handle.x, handle.y, handle === handles.rotate ? 7 : 5.5, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }
  context.restore()
}

export function createPreviewCache(onChange, onError) {
  const entries = new Map()

  function add(asset, maxEdge) {
    const entry = {}
    entries.set(asset.id, entry)
    const dimensions = asset.bounds ?? asset
    const blob = asset.cutout ?? asset.blob
    decodeImage(blob, fitSize(dimensions.width, dimensions.height, maxEdge))
      .then((bitmap) => {
        if (entries.get(asset.id) !== entry) {
          releaseImage(bitmap)
          return
        }
        entry.bitmap = bitmap
        if (asset.cutout) {
          const thumb = fitSize(dimensions.width, dimensions.height, 64)
          const canvas = createCanvas(thumb.width, thumb.height)
          const context = context2d(canvas, { willReadFrequently: true })
          context.drawImage(bitmap, 0, 0, thumb.width, thumb.height)
          entry.hitMap = context.getImageData(0, 0, thumb.width, thumb.height)
          releaseImage(canvas)
        }
        onChange()
      })
      .catch(() => {
        if (entries.get(asset.id) === entry) onError()
      })
  }

  function sync(assets, backgroundId) {
    for (const [id, entry] of entries) {
      if (assets.has(id)) continue
      releaseShadows(entry.bitmap)
      releaseImage(entry.bitmap)
      entries.delete(id)
    }
    const objects = Math.max(1, assets.size - 1)
    const edge = Math.min(960, Math.max(160, Math.round(Math.sqrt(3_500_000 / objects))))
    for (const asset of assets.values()) {
      if (!entries.has(asset.id)) add(asset, asset.id === backgroundId ? 1600 : edge)
    }
  }

  return { sync, get: (id) => entries.get(id), dispose: () => sync(new Map()) }
}
