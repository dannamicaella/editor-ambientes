import { clamp, wrapAngle } from '../utils/geometry.js'

export function createProject(background, id = crypto.randomUUID()) {
  return {
    project: { id, name: 'Montagem sem título', backgroundId: background.id, layers: [] },
    assets: new Map([[background.id, background]]),
    isNew: true,
  }
}

export function projectAssetIds(project) {
  return new Set([project.backgroundId, ...project.layers.map((layer) => layer.assetId)])
}

export function createLayer(asset, id = crypto.randomUUID()) {
  return { id, name: asset.name, assetId: asset.id, x: 0.5, y: 0.5, scale: 0.36, rotation: 0, opacity: 1, shadow: false }
}

export function alterLayer(project, id, patch) {
  return {
    ...project,
    layers: project.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
  }
}

export function addLayer(project, layer) {
  return { ...project, layers: [...project.layers, layer] }
}

export function removeLayer(project, id) {
  return { ...project, layers: project.layers.filter((layer) => layer.id !== id) }
}

export function duplicateLayer(project, id, newId = crypto.randomUUID()) {
  const original = project.layers.find((layer) => layer.id === id)
  if (!original) return project
  const copy = {
    ...original, id: newId, name: original.name + ' (cópia)',
    x: clamp(original.x + 0.045, 0, 1), y: clamp(original.y + 0.045, 0, 1),
  }
  return addLayer(project, copy)
}

export function reorderLayer(project, id, delta) {
  const layers = [...project.layers]
  const index = layers.findIndex((layer) => layer.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= layers.length) return project
  const [layer] = layers.splice(index, 1)
  layers.splice(target, 0, layer)
  return { ...project, layers }
}

export function constrainTransform(transform) {
  return {
    x: clamp(transform.x, -0.25, 1.25),
    y: clamp(transform.y, -0.25, 1.25),
    scale: clamp(transform.scale, 0.025, 3),
    rotation: wrapAngle(transform.rotation),
  }
}

export function layerBox(layer, asset, frame) {
  const longest = Math.min(frame.width, frame.height) * layer.scale
  const factor = longest / Math.max(asset.bounds.width, asset.bounds.height)
  return {
    centerX: frame.x + frame.width * layer.x,
    centerY: frame.y + frame.height * layer.y,
    width: asset.bounds.width * factor,
    height: asset.bounds.height * factor,
  }
}

export function adjustForMask(layer, previous, replacement, background) {
  const sx = previous.width ? replacement.width / previous.width : 1
  const sy = previous.height ? replacement.height / previous.height : 1
  const a = {
    x: previous.bounds.x * sx,
    y: previous.bounds.y * sy,
    width: previous.bounds.width * sx,
    height: previous.bounds.height * sy,
  }
  const b = replacement.bounds
  const ratio = Math.min(background.width, background.height) * layer.scale / Math.max(a.width, a.height)
  const degrees = layer.rotation * Math.PI / 180
  const dx = (b.x + b.width / 2 - a.x - a.width / 2) * ratio
  const dy = (b.y + b.height / 2 - a.y - a.height / 2) * ratio
  return {
    assetId: replacement.id,
    scale: layer.scale * Math.max(b.width, b.height) / Math.max(a.width, a.height),
    x: layer.x + (dx * Math.cos(degrees) - dy * Math.sin(degrees)) / background.width,
    y: layer.y + (dx * Math.sin(degrees) + dy * Math.cos(degrees)) / background.height,
  }
}
