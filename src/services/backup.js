import { imageHeader } from '../utils/imageHeader.js'
import { blobHash, digest, hex } from './backupContent.js'

const MAGIC = new TextEncoder().encode('EABACKUP')
const VERSION = 1
const HEADER_SIZE = 48
const MAX_MANIFEST = 16 * 1024 ** 2
const MAX_IMAGE = 256 * 1024 ** 2
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const imageFields = ['blob', 'cutout', 'mask']
const encoder = new TextEncoder()

function check(valid, message = 'O backup tem dados inválidos ou referências incompletas.') {
  if (!valid) throw new Error(message)
}

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 240
const isName = (value) => typeof value === 'string' && value.length <= 1024
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max
const isInteger = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max)
const isOptional = (value, predicate) => value === undefined || predicate(value)
const dimensions = (width, height) => isInteger(width, 1, 12000) && isInteger(height, 1, 12000) && width * height <= 32_000_000
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function shape(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => fields.includes(key))
}

function unique(records) {
  check(Array.isArray(records))
  const ids = new Set()
  for (const record of records) {
    check(isId(record?.id) && !ids.has(record.id))
    ids.add(record.id)
  }
  return ids
}

function regionFits(region, asset) {
  return shape(region, ['x', 'y', 'width', 'height']) && dimensions(region.width, region.height) &&
    isInteger(region.x, 0, asset.width - region.width) && isInteger(region.y, 0, asset.height - region.height)
}

function validShadow(shadow) {
  if (typeof shadow === 'boolean') return true
  return shape(shadow, ['enabled', 'opacity', 'blur', 'x', 'y', 'color', 'contact']) &&
    typeof shadow.enabled === 'boolean' && within(shadow.opacity, 0, 100) && within(shadow.blur, 0, 18) &&
    within(shadow.x, -25, 25) && within(shadow.y, -25, 25) && within(shadow.contact, 0, 100) &&
    typeof shadow.color === 'string' && /^#[a-f\d]{6}$/i.test(shadow.color)
}

function validate(manifest) {
  check(shape(manifest, ['groups', 'media', 'cutouts', 'blobs']))
  const { groups, media, cutouts, blobs } = manifest
  const mediaIds = unique(media)
  unique(cutouts)
  check(Array.isArray(groups) && Array.isArray(blobs))
  unique(groups.map((group) => group?.project))
  const blobUsers = new Map()
  const usedMedia = new Set()
  const mediaById = new Map(media.map((asset) => [asset.id, asset]))

  function usesBlob(index, type, size) {
    check(isInteger(index, 0, blobs.length - 1))
    check(!type || blobs[index]?.type === type)
    if (!blobUsers.has(index)) blobUsers.set(index, [])
    if (size) blobUsers.get(index).push(size)
  }

  function usesImage(id, cutout) {
    check(mediaIds.has(id) && (!cutout || mediaById.get(id).cutout !== undefined))
    usedMedia.add(id)
  }

  for (const asset of media) {
    check(shape(asset, ['id', 'name', 'width', 'height', 'originalWidth', 'originalHeight', 'bounds', 'maskRegion', ...imageFields]) &&
      dimensions(asset.width, asset.height) && isOptional(asset.name, isName) &&
      isOptional(asset.originalWidth, (value) => isInteger(value, 1, 12000)) &&
      isOptional(asset.originalHeight, (value) => isInteger(value, 1, 12000)))
    usesBlob(asset.blob)
    if (asset.cutout !== undefined) {
      check(regionFits(asset.bounds, asset))
      usesBlob(asset.cutout, 'image/png', asset.bounds)
    } else check(asset.bounds === undefined)
    if (asset.mask !== undefined) {
      check(asset.cutout !== undefined && isOptional(asset.maskRegion, (region) => regionFits(region, asset)))
      usesBlob(asset.mask, 'image/png', asset.maskRegion)
    } else check(asset.maskRegion === undefined)
  }
  for (const group of groups) {
    check(shape(group, ['project', 'summary']))
    const { project, summary } = group
    check(shape(project, ['id', 'name', 'backgroundId', 'layers']) && isName(project.name))
    unique(project.layers)
    usesImage(project.backgroundId, false)
    for (const layer of project.layers) {
      check(shape(layer, ['id', 'assetId', 'name', 'x', 'y', 'scale', 'rotation', 'opacity', 'shadow']) &&
        isName(layer.name) && within(layer.x, -10_000, 10_000) && within(layer.y, -10_000, 10_000) &&
        within(layer.scale, Number.MIN_VALUE, 10_000) && within(layer.rotation, -360, 360) &&
        within(layer.opacity, 0, 1) && isOptional(layer.shadow, validShadow))
      usesImage(layer.assetId, true)
    }
    check(shape(summary, ['id', 'name', 'count', 'updatedAt', 'thumbnail']) && summary.id === project.id &&
      summary.name === project.name && summary.count === project.layers.length &&
      isInteger(summary.updatedAt, 0, 8.64e15))
    if (summary.thumbnail !== undefined) usesBlob(summary.thumbnail)
  }
  for (const cutout of cutouts) {
    check(shape(cutout, ['id', 'name', 'assetId', 'createdAt', 'thumbnail']) &&
      isName(cutout.name) && isInteger(cutout.createdAt, 0, 8.64e15))
    usesImage(cutout.assetId, true)
    if (cutout.thumbnail !== undefined) usesBlob(cutout.thumbnail)
  }
  check(usedMedia.size === media.length && blobUsers.size === blobs.length)
  for (const blob of blobs) {
    check(shape(blob, ['size', 'type', 'hash']) && isInteger(blob.size, 1, MAX_IMAGE) &&
      IMAGE_TYPES.has(blob.type) && isHash(blob.hash))
  }
  return blobUsers
}

async function photoHeader(blob) {
  const header = imageHeader(await blob.slice(0, 512 * 1024).arrayBuffer())
  check(header && (header.width === undefined || dimensions(header.width, header.height)),
    'Uma imagem do backup tem um formato ou dimensões inválidos.')
  return header
}

function fitsImage(header, type, users) {
  check(type === 'image/' + header.format && users.every(({ width, height }) =>
    width === header.width && height === header.height), 'Uma imagem não corresponde aos metadados do backup.')
}

function withFiles(record, fields, convert) {
  const copy = { ...record }
  for (const field of fields) {
    if (record[field] !== undefined) copy[field] = convert(record[field])
  }
  return copy
}

export async function encodeBackup(snapshot, progress = () => {}) {
  const files = []
  const positions = new Map()
  function index(blob) {
    check(blob instanceof Blob && isInteger(blob.size, 1, MAX_IMAGE), 'O backup contém uma imagem indisponível ou acima do limite de 256 MiB.')
    if (!positions.has(blob)) {
      positions.set(blob, files.length)
      files.push(blob)
    }
    return positions.get(blob)
  }
  const groups = snapshot.groups.map(({ project, summary }) => ({ project, summary: withFiles(summary, ['thumbnail'], index) }))
  const media = snapshot.media.map((asset) => withFiles(asset, imageFields, index))
  const cutouts = snapshot.cutouts.map((cutout) => withFiles(cutout, ['thumbnail'], index))
  const blobs = []
  const headers = []
  const total = files.reduce((sum, blob) => sum + blob.size, 0)
  let done = 0
  for (const blob of files) {
    const header = await photoHeader(blob)
    const hash = await blobHash(blob, (size) => { done += size; progress(done, total) })
    blobs.push({ size: blob.size, type: 'image/' + header.format, hash })
    headers.push(header)
  }
  const manifest = { groups, media, cutouts, blobs }
  const users = validate(manifest)
  headers.forEach((header, index) => fitsImage(header, blobs[index].type, users.get(index)))
  const body = encoder.encode(JSON.stringify(manifest))
  check(body.byteLength <= MAX_MANIFEST, 'Os metadados excedem o limite de 16 MiB deste formato de backup.')
  const header = new Uint8Array(HEADER_SIZE)
  header.set(MAGIC)
  const view = new DataView(header.buffer)
  view.setUint32(8, VERSION)
  view.setUint32(12, body.byteLength)
  header.set(await digest(body), 16)
  return new Blob([header, body, ...files], { type: 'application/octet-stream' })
}

export async function inspectBackup(file) {
  check(file instanceof Blob && file.size >= HEADER_SIZE, 'Este arquivo não é um backup do Editor de Ambientes.')
  const header = new Uint8Array(await file.slice(0, HEADER_SIZE).arrayBuffer())
  check(MAGIC.every((byte, index) => header[index] === byte), 'Este arquivo não é um backup do Editor de Ambientes.')
  const view = new DataView(header.buffer)
  check(view.getUint32(8) === VERSION, 'A versão deste backup é incompatível com o editor.')
  const length = view.getUint32(12)
  check(isInteger(length, 1, MAX_MANIFEST) && HEADER_SIZE + length <= file.size, 'O backup está incompleto ou tem metadados inválidos.')
  const body = await file.slice(HEADER_SIZE, HEADER_SIZE + length).arrayBuffer()
  const fingerprint = hex(await digest(body))
  check(fingerprint === hex(header.subarray(16)), 'Os metadados do backup foram corrompidos.')
  let manifest
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch {
    throw new Error('Os metadados do backup são inválidos.')
  }
  const blobUsers = validate(manifest)
  let offset = HEADER_SIZE + length
  for (const { size } of manifest.blobs) offset += size
  check(offset === file.size, 'O arquivo de backup está incompleto ou tem um tamanho inesperado.')
  return { file, fingerprint, manifest, blobUsers, start: HEADER_SIZE + length }
}

export async function verifyBackup(prepared, progress = () => {}) {
  const { file, manifest, blobUsers, start } = prepared
  const blobs = []
  let offset = start
  let done = 0
  for (const [index, item] of manifest.blobs.entries()) {
    const { size, type, hash } = item
    const blob = file.slice(offset, offset + size, type)
    offset += size
    fitsImage(await photoHeader(blob), type, blobUsers.get(index))
    const actual = await blobHash(blob, (bytes) => { done += bytes; progress(done, file.size - start) })
    check(actual === hash, 'Uma imagem do backup foi corrompida.')
    blobs.push(blob)
  }
  const fileAt = (index) => blobs[index]
  return {
    groups: manifest.groups.map(({ project, summary }) => ({ project, summary: withFiles(summary, ['thumbnail'], fileAt) })),
    media: manifest.media.map((asset) => withFiles(asset, imageFields, fileAt)),
    cutouts: manifest.cutouts.map((cutout) => withFiles(cutout, ['thumbnail'], fileAt)),
  }
}

export function backupCounts(prepared) {
  return { projects: prepared.manifest.groups.length, cutouts: prepared.manifest.cutouts.length }
}

export async function storageEstimate() {
  try {
    const usage = await globalThis.navigator?.storage?.estimate()
    if (within(usage?.usage, 0, Number.MAX_SAFE_INTEGER) && within(usage?.quota, 0, Number.MAX_SAFE_INTEGER)) {
      return { used: usage.usage, quota: usage.quota, available: Math.max(0, usage.quota - usage.usage) }
    }
  } catch { /* The browser can block estimates in some contexts. */ }
}

export function backupFileName(date = new Date()) {
  const local = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-')
  return 'editor-de-ambientes-' + local + '.eabackup'
}
