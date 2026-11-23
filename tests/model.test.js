import assert from 'node:assert/strict'
import test from 'node:test'
import { createHistory } from '../src/composables/history.js'
import { AUTO_SHADOW, shadowSettings } from '../src/composables/shadowModel.js'
import { addLayer, adjustForMask, alterLayer, constrainTransform, createLayer, createProject, duplicateLayer, layerBox, projectAssetIds, removeLayer, reorderLayer } from '../src/composables/projectModel.js'
import { exportChoices, fileName } from '../src/services/export.js'
import { fitSize } from '../src/utils/geometry.js'

const background = { id: 'background', width: 4000, height: 3000 }
const asset = { id: 'pillow', name: 'Almofada', bounds: { x: 10, y: 10, width: 240, height: 120 } }

test('cria montagem com fundo original e adiciona camada proporcional', () => {
  const { project, assets } = createProject(background, 'new')
  const layer = createLayer(asset, 'item')
  const withLayer = addLayer(project, layer)
  const box = layerBox(layer, asset, { x: 0, y: 0, ...background })
  assert.equal(box.width / box.height, 2)
  assert.equal(assets.get(project.backgroundId), background)
  assert.deepEqual([...projectAssetIds(withLayer)], [background.id, asset.id])
  assert.deepEqual(project.layers, [])
})

test('move, redimensiona, gira, duplica e reordena com identidade independente', () => {
  const initial = addLayer(createProject(background, 'new').project, createLayer(asset, 'item'))
  const moved = alterLayer(initial, 'item', constrainTransform({ x: .3, y: .8, scale: .5, rotation: 395 }))
  const duplicated = duplicateLayer(moved, 'item', 'copy')
  const [original, copy] = duplicated.layers
  assert.equal(original.rotation, 35)
  assert.equal(original.x, .3)
  assert.equal(copy.assetId, original.assetId)
  for (const property of ['scale', 'rotation', 'opacity', 'shadow']) assert.equal(copy[property], original[property])
  assert.notEqual(copy.x, original.x)
  const reordered = reorderLayer(duplicated, 'copy', -1)
  assert.deepEqual(reordered.layers.map(({ id }) => id), ['copy', 'item'])
  assert.deepEqual(removeLayer(reordered, 'item').layers.map(({ id }) => id), ['copy'])
})

test('desfazer e refazer reutilizam estados e descartam o ramo após nova edição', () => {
  const initial = createProject(background, 'draft').project
  const history = createHistory(initial, 2)
  const first = addLayer(initial, createLayer(asset, 'item'))
  const second = duplicateLayer(first, 'item', 'copy')
  history.commit(first)
  history.commit(second)
  assert.equal(history.undo(), first)
  assert.equal(history.redo(), second)
  assert.equal(history.undo(), first)
  const third = alterLayer(first, 'item', { opacity: .5 })
  history.commit(third)
  assert.equal(history.canRedo, false)
  assert.equal(history.undo(), first)
  assert.equal(history.undo(), initial)
})

test('recortar uma camada novamente preserva a posição visual relativa dos pixels', () => {
  const layer = { ...createLayer(asset, 'item'), rotation: 90 }
  const replacement = { id: 'new-mask', bounds: { x: 70, y: 10, width: 180, height: 120 } }
  const patch = adjustForMask(layer, asset, replacement, background)
  assert.equal(patch.assetId, replacement.id)
  assert(Math.abs(patch.scale - layer.scale * .75) < 1e-12)
  assert(Math.abs(patch.x - layer.x) < 1e-12)
  assert(Math.abs(patch.y - layer.y - .045) < 1e-12)
})

test('opções de exportação respeitam área, lado, proporção e nomes seguros', () => {
  const [large, compact] = exportChoices({ width: 12000, height: 6000 })
  assert.equal(large.width, 4096)
  assert.equal(large.height, 2048)
  assert.equal(compact.width, 1920)
  assert.deepEqual(fitSize(200, 100, 512), { width: 200, height: 100 })
  assert.equal(fileName('  Sala: poltrona / sofá  ', 'image/jpeg'), 'Sala- poltrona - sofá.jpg')
})

test('atualizar máscara de projeto antigo para a resolução nativa mantém a composição', () => {
  const previous = { ...asset, width: 1200, height: 800 }
  const replacement = { id: 'native', width: 3600, height: 2400, bounds: { x: 30, y: 30, width: 720, height: 360 } }
  const layer = { ...createLayer(previous, 'item'), rotation: 37 }
  assert.deepEqual(adjustForMask(layer, previous, replacement, background), {
    assetId: 'native', x: layer.x, y: layer.y, scale: layer.scale,
  })
})
test('normaliza ajustes de sombra e mantém cópias editadas independentes', () => {
  assert.equal(shadowSettings(true).enabled, true)
  assert.equal(shadowSettings(true).contact, 0)
  assert.equal(shadowSettings(false).enabled, false)
  const shadow = shadowSettings({ ...AUTO_SHADOW, opacity: 120, blur: -2, color: 'red' })
  assert.deepEqual(shadow, { ...AUTO_SHADOW, opacity: 100, blur: 0 })
  const initial = addLayer(createProject(background, 'new').project, { ...createLayer(asset, 'item'), shadow })
  const duplicated = duplicateLayer(initial, 'item', 'copy')
  const edited = alterLayer(duplicated, 'copy', { shadow: { ...shadow, x: -9 } })
  assert.equal(edited.layers[0].shadow.x, 0)
  assert.equal(edited.layers[1].shadow.x, -9)
})
