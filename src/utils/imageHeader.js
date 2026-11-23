const jpegFrames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function jpegSize(bytes, view) {
  let position = 2
  while (position + 3 < bytes.length && bytes[position] === 0xff) {
    while (bytes[position] === 0xff) position++
    const marker = bytes[position++]
    if (marker === 0xda || marker === 0xd9 || position + 2 > bytes.length) break
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = view.getUint16(position)
    if (length < 2) break
    if (jpegFrames.has(marker) && length >= 7 && position + 7 <= bytes.length) {
      return { width: view.getUint16(position + 5), height: view.getUint16(position + 3) }
    }
    position += length
  }
  return {}
}

function matches(bytes, offset, text) {
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

function webpSize(bytes, view) {
  if (bytes.length >= 30 && matches(bytes, 12, 'VP8X')) {
    const uint24 = (offset) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
    return { width: uint24(24) + 1, height: uint24(27) + 1 }
  }
  if (bytes.length >= 25 && matches(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
    const data = view.getUint32(21, true)
    return { width: (data & 0x3fff) + 1, height: ((data >>> 14) & 0x3fff) + 1 }
  }
  if (bytes.length >= 30 && matches(bytes, 12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  return {}
}

/** Read size hints before allocating a decoded image. The browser validates the complete file. */
export function imageHeader(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { format: 'jpeg', ...jpegSize(bytes, view) }
  if (bytes.length >= 24 && bytes[0] === 137 && matches(bytes, 1, 'PNG\r\n\x1a\n') && matches(bytes, 12, 'IHDR')) {
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (matches(bytes, 0, 'RIFF') && matches(bytes, 8, 'WEBP')) return { format: 'webp', ...webpSize(bytes, view) }
  return null
}