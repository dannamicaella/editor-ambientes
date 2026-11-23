import { projectAssetIds } from '../composables/projectModel.js'

const CHUNK_SIZE = 1024 ** 2
const blobHashes = new WeakMap()
const encoder = new TextEncoder()

export async function digest(buffer) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
}

export function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function blobHash(blob, progress = () => {}) {
  const cached = blobHashes.get(blob)
  if (cached) {
    progress(blob.size)
    return cached
  }
  // The v1 format hashes the ordered concatenation of the 1 MiB slice digests.
  const chunks = new Uint8Array(32 * Math.ceil(blob.size / CHUNK_SIZE))
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    const part = blob.slice(offset, offset + CHUNK_SIZE)
    chunks.set(await digest(await part.arrayBuffer()), 32 * (offset / CHUNK_SIZE))
    progress(part.size)
  }
  const hash = hex(await digest(chunks))
  blobHashes.set(blob, hash)
  return hash
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

async function fingerprint(value) {
  return hex(await digest(encoder.encode(JSON.stringify(canonical(value)))))
}

async function mediaFingerprints(media) {
  const keys = new Map()
  for (const { id, blob, mask, cutout, ...editable } of media) {
    keys.set(id, await fingerprint({
      ...editable, blob: await blobHash(blob),
      mask: mask && await blobHash(mask), cutout: cutout && await blobHash(cutout),
    }))
  }
  return keys
}

export async function contentFingerprints(snapshot) {
  const media = await mediaFingerprints(snapshot.media)
  const projects = new Map()
  for (const { project } of snapshot.groups) {
    const { id, backgroundId, layers, ...editable } = project
    projects.set(id, await fingerprint([
      editable, media.get(backgroundId),
      layers.map(({ id, assetId, ...layer }) => {
        void id
        return [layer, media.get(assetId)]
      }),
    ]))
  }
  const cutouts = new Map()
  for (const { id, assetId, createdAt, thumbnail, ...editable } of snapshot.cutouts) {
    void createdAt
    void thumbnail
    cutouts.set(id, await fingerprint([editable, media.get(assetId)]))
  }
  return { media, projects, cutouts }
}

function missing(records, occupied, keyFor) {
  const unique = new Set(occupied)
  return records.filter((record) => {
    const key = keyFor(record)
    if (unique.has(key)) return false
    unique.add(key)
    return true
  })
}

export function planBackupMerge(snapshot, incoming, local, sharedMediaIds) {
  const groups = missing(snapshot.groups, local.projects.values(), ({ project }) => incoming.projects.get(project.id))
  const cutouts = missing(snapshot.cutouts, local.cutouts.values(), ({ id }) => incoming.cutouts.get(id))
  const needed = new Set(cutouts.map(({ assetId }) => assetId))
  for (const { project } of groups) {
    for (const id of projectAssetIds(project)) needed.add(id)
  }

  const available = new Map()
  for (const [id, key] of local.media) {
    if (sharedMediaIds.has(id) && !available.has(key)) available.set(key, id)
  }
  const media = []
  const reused = new Map()
  const pending = new Map()
  const representatives = new Map()
  for (const asset of snapshot.media) {
    if (!needed.has(asset.id)) continue
    const key = incoming.media.get(asset.id)
    if (available.has(key)) {
      reused.set(asset.id, available.get(key))
    } else {
      if (!representatives.has(key)) {
        representatives.set(key, asset.id)
        media.push(asset)
      }
      pending.set(asset.id, representatives.get(key))
    }
  }

  return {
    groups, cutouts, media, reused, pending,
    ignoredProjects: snapshot.groups.length - groups.length,
    ignoredCutouts: snapshot.cutouts.length - cutouts.length,
  }
}
