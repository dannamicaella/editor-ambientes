import { fitSize } from '../utils/geometry.js'
import { imageHeader } from '../utils/imageHeader.js'

export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp'
export const LIMIT_INPUT = 32 * 1024 * 1024
const MAX_IMPORT_PIXELS = 32_000_000

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function context2d(canvas, options) {
  const context = canvas.getContext('2d', options)
  if (!context) throw new Error('O navegador não conseguiu preparar a área de imagem.')
  return context
}

export function encodeCanvas(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size && blob.type === type) resolve(blob)
      else reject(new Error('Não foi possível gerar a imagem nas dimensões escolhidas.'))
    }, type, quality)
  })
}

export async function decodeImage(blob, size) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        ...(size && { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' }),
      })
    } catch (error) {
      if (!size) throw error
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!size) return image
    const canvas = createCanvas(size.width, size.height)
    const context = context2d(canvas)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function importPhoto(file, purpose) {
  if (!file?.size || file.size > LIMIT_INPUT) throw new Error('Escolha uma foto com até 32 MB.')
  const header = imageHeader(await file.slice(0, 512 * 1024).arrayBuffer())
  if (!header) throw new Error('Escolha uma foto JPEG, PNG ou WebP.')
  if (header.width !== undefined) validateDimensions(header.width, header.height)
  const asset = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]*$/, '') || 'Fotografia', blob: file }
  let image
  let preview
  try {
    image = await decodeImage(file)
  } catch {
    throw new Error('Não foi possível abrir a foto. Experimente um arquivo JPEG, PNG ou WebP.')
  }

  try {
    const { width, height } = image
    validateDimensions(width, height)
    const size = purpose === 'object' ? fitSize(width, height, 2400, 4_000_000) : { width, height }
    asset.width = width
    asset.height = height
    asset.originalWidth = width
    asset.originalHeight = height
    if (purpose === 'object') {
      if (size.width === width && size.height === height) {
        preview = image
      } else {
        const canvas = createCanvas(size.width, size.height)
        const context = context2d(canvas)
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, size.width, size.height)
        preview = canvas
      }
      return { asset, image: preview }
    }
    return { asset }
  } finally {
    if (preview !== image) releaseImage(image)
  }
}

function validateDimensions(width, height) {
  if (!width || !height) throw new Error('A fotografia contém dimensões inválidas.')
  if (width * height > MAX_IMPORT_PIXELS || Math.max(width, height) > 12000) {
    throw new Error('A foto é grande demais. Escolha uma versão com até 32 megapixels e 12.000 px por lado.')
  }
}

export function releaseImage(image) {
  if (image?.close) image.close()
  else if (image instanceof HTMLCanvasElement) image.width = image.height = 1
}
