import { context2d, createCanvas, decodeImage, encodeCanvas, releaseImage } from './images.js'

export function contourPath(context, points) {
  context.beginPath()
  traceContour(context, points)
}

function traceContour(target, points) {
  points.forEach(({ x, y }, index) => {
    if (index) target.lineTo(x, y)
    else target.moveTo(x, y)
  })
}

export function contourRegion(points, frame, padding = 0) {
  let left = frame.width
  let top = frame.height
  let right = 0
  let bottom = 0
  for (const { x, y } of points) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  const x = Math.max(0, Math.floor(left - padding))
  const y = Math.max(0, Math.floor(top - padding))
  return {
    x, y,
    width: Math.min(frame.width, Math.ceil(right + padding)) - x,
    height: Math.min(frame.height, Math.ceil(bottom + padding)) - y,
  }
}

function regionCanvas(region) {
  return { ...region, canvas: createCanvas(region.width, region.height) }
}

export function contourMask(frame, points) {
  return polygonMask(frame, [points])
}

export function polygonMask(frame, polygons) {
  if (!polygons.length) throw new Error('A máscara não contém uma região visível. Ajuste as indicações e tente novamente.')
  const mask = regionCanvas(contourRegion(polygons.flat(), frame, 1))
  try {
    const output = context2d(mask.canvas)
    output.translate(-mask.x, -mask.y)
    output.beginPath()
    for (const polygon of polygons) {
      traceContour(output, polygon)
      output.closePath()
    }
    output.fill('evenodd')
    output.resetTransform()
    return mask
  } catch (error) {
    releaseImage(mask.canvas)
    throw error
  }
}

export function savedMask(bitmap, region) {
  const mask = regionCanvas(region)
  context2d(mask.canvas).drawImage(bitmap, 0, 0, mask.width, mask.height)
  return mask
}

export function strokeMask(mask, frame, stroke, previous, current) {
  const radius = stroke.width / 2 + 1
  if (stroke.tool === 'restore') {
    const points = previous ? [previous, current] : [current]
    const needed = contourRegion(points, frame, radius)
    const room = contourRegion(points, frame, radius + 48)
    const x = needed.x < mask.x ? room.x : mask.x
    const y = needed.y < mask.y ? room.y : mask.y
    const right = mask.x + mask.width
    const bottom = mask.y + mask.height
    const width = (needed.x + needed.width > right ? room.x + room.width : right) - x
    const height = (needed.y + needed.height > bottom ? room.y + room.height : bottom) - y
    if (width !== mask.width || height !== mask.height) {
      const expanded = regionCanvas({ x, y, width, height })
      context2d(expanded.canvas).drawImage(mask.canvas, mask.x - x, mask.y - y)
      releaseImage(mask.canvas)
      Object.assign(mask, expanded)
    }
  }

  const context = context2d(mask.canvas)
  context.save()
  context.translate(-mask.x, -mask.y)
  context.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over'
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.beginPath()
  if (previous) {
    context.moveTo(previous.x, previous.y)
    context.lineTo(current.x, current.y)
    context.stroke()
  } else {
    context.arc(current.x, current.y, stroke.width / 2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

export function drawMasked(context, image, mask, frame, box) {
  const sx = box.width / frame.width
  const sy = box.height / frame.height
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.save()
  context.imageSmoothingQuality = 'high'
  context.drawImage(mask.canvas, box.x + mask.x * sx, box.y + mask.y * sy, mask.width * sx, mask.height * sy)
  context.globalCompositeOperation = 'source-in'
  context.drawImage(image, box.x, box.y, box.width, box.height)
  context.restore()
}

function alphaBounds(canvas) {
  const { width, height } = canvas
  const context = context2d(canvas)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  const rows = Math.max(1, Math.floor(256_000 / width))
  for (let start = 0; start < height; start += rows) {
    const count = Math.min(rows, height - start)
    const { data } = context.getImageData(0, start, width, count)
    for (let row = 0; row < count; row++) {
      for (let x = 0; x < width; x++) {
        if (!data[(row * width + x) * 4 + 3]) continue
        if (x < left) left = x
        if (x > right) right = x
        if (start + row < top) top = start + row
        if (start + row > bottom) bottom = start + row
      }
    }
  }
  if (right < left) throw new Error('O recorte está vazio. Restaure parte do objeto antes de confirmar.')
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

export async function finishMask(asset, mask, preview) {
  const { canvas, ...maskRegion } = mask
  const nativePreview = preview.width === asset.width && preview.height === asset.height
  const local = alphaBounds(canvas)
  const bounds = { ...local, x: mask.x + local.x, y: mask.y + local.y }
  let crop = createCanvas(bounds.width, bounds.height)
  let image
  try {
    image = nativePreview ? preview : await decodeImage(asset.blob)
    const context = context2d(crop)
    context.drawImage(canvas, -local.x, -local.y)
    context.globalCompositeOperation = 'source-in'
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)
    if (!nativePreview) {
      releaseImage(image)
      image = undefined
    }
    // Preserve the tight object bounds when the source already contains transparency.
    if (asset.blob.type !== 'image/jpeg') {
      const content = alphaBounds(crop)
      if (content.width !== bounds.width || content.height !== bounds.height) {
        const trimmed = createCanvas(content.width, content.height)
        context2d(trimmed).drawImage(crop, -content.x, -content.y)
        releaseImage(crop)
        crop = trimmed
        Object.assign(bounds, {
          x: bounds.x + content.x, y: bounds.y + content.y, width: content.width, height: content.height,
        })
      }
    }
    const [cutout, alpha] = await Promise.all([encodeCanvas(crop), encodeCanvas(canvas)])
    return { ...asset, id: crypto.randomUUID(), cutout, mask: alpha, maskRegion, bounds }
  } finally {
    if (!nativePreview) releaseImage(image)
    releaseImage(crop)
  }
}
