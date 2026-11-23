import assert from 'node:assert/strict'
import test from 'node:test'
import { bestMask, guidedRegion, maskPolygons, modelPrompts, relativePrompts, resizedImage, selectMask, updatePrompt } from '../src/services/mobileSamGeometry.js'
import { rasterizeContour } from '../src/utils/contour.js'

test('fecha o contorno manual irregular e preserva uma concavidade externa', () => {
  const points = [{x: 18, y: 17}, {x: 108, y: 17}, {x: 108, y: 83}, {x: 63, y: 59}, {x: 18, y: 83}]
  const width = 126
  const mask = rasterizeContour(points, width, 100)
  assert.equal(mask[45 * width + 53], 1)
  assert.equal(mask[72 * width + 63], 0)
  assert.equal(mask[71 * width + 24], 1)
})

test('projeta cliques e caixa para a imagem redimensionada sem deslocar pelo padding', () => {
  const size = resizedImage(1200, 800)
  assert.deepEqual(size, { width: 1024, height: 683 })
  const prompts = modelPrompts([{ x: 0.5, y: 0.5, type: 'positive' }, { x: 0.75, y: 0.25, type: 'negative' }],
    { x: 0.125, y: 0, right: 0.875, bottom: 1 }, size)
  assert.deepEqual([...prompts.labels], [1, 0, 2, 3])
  assert.deepEqual([...prompts.coordinates], [512, 341.5, 768, 170.75, 128, 0, 896, 683])
  assert.deepEqual([...modelPrompts([{ x: 0.5, y: 0.5, type: 'positive' }], undefined, size).labels], [1, -1])
})

test('prefere a máscara que respeita os cliques mesmo com um escore inicial menor', () => {
  const side = 4
  const scores = Float32Array.of(0.99, 0.72)
  const logits = new Float32Array(2 * side * side).fill(-1)
  logits.set([1, 1, 1, 1], 0)
  logits[16 + 1] = 1
  logits[16 + 15] = 1
  const points = [{ x: 0.35, y: 0.1, type: 'positive' }, { x: 0.75, y: 0.1, type: 'negative' }]
  const best = bestMask(logits, scores, side, points, undefined, { width: 1024, height: 1024 })
  assert.equal(best[1], 1)
  assert.equal(best[3], -1)
  assert.equal(best[15], -1)
})

test('usa margem no contorno guia e projeta a máscara de volta ao local exato da foto', () => {
  const region = guidedRegion(1000, 1000, { x: 0.3, y: 0.3, right: 0.7, bottom: 0.7 })
  const { points } = relativePrompts([{ x: 0.5, y: 0.5, type: 'positive' }, { x: 0, y: 0, type: 'negative' }], undefined, region)
  assert.equal(points.length, 1)
  assert(Math.abs(points[0].x - 0.5) <= 0.001)
  const polygons = maskPolygons(Float32Array.of(1, 1, 1, 1), 2, { width: 1024, height: 1024 },
    { width: 1000, height: 1000 }, region)
  const x = polygons[0].map((point) => point.x)
  assert.equal(Math.min(...x), region.x * 1000)
  assert.equal(Math.max(...x), (region.x + region.width) * 1000)
})

test('Manter substitui um Remover no mesmo detalhe e repetir o toque não duplica a orientação', () => {
  const frame = { width: 900, height: 1600 }
  const previous = [{ x: 0.2, y: 0.3, type: 'positive' }, { x: 0.5, y: 0.6, type: 'negative' }]
  const point = { x: 0.502, y: 0.601, type: 'positive' }
  const next = updatePrompt(previous, point, frame)
  assert.deepEqual(next, [previous[0], point])
  assert.equal(updatePrompt(next, point, frame), next)
})

test('protege detalhes internos sem preencher o exterior nem ignorar uma exclusão explícita', () => {
  const side = 18
  const logits = new Float32Array(side * side).fill(-1)
  for (let y = 2; y < 16; y++) for (let x = 2; x < 16; x++) logits[y * side + x] = 1
  const hole = 8 * side + 8
  logits[hole] = -2
  const size = { width: 1024, height: 1024 }
  const point = { x: 8.5 / side, y: 8.5 / side, type: 'negative' }
  const removed = selectMask(logits, [0.8], side, [point], undefined, size, undefined, true, 0)
  assert(removed.logits[hole] < 0)
  assert(removed.correctionSatisfied)
  const kept = selectMask(logits, [0.8], side, [{ ...point, type: 'positive' }], undefined, size, removed.logits, true, 0)
  assert(kept.logits[hole] > 0)
  assert(kept.correctionSatisfied)
  assert(kept.logits[0] < 0)
  assert(kept.raw[hole] < 0)
})

test('uma correção na borda preserva estampas internas já aceitas e mantém furos anteriores', () => {
  const side = 32
  const full = new Float32Array(side * side).fill(-1)
  for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) full[y * side + x] = 1
  const stamp = 10 * side + 10
  const genuineHole = 20 * side + 20
  const correction = full.slice()
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) correction[y * side + x] = -1
  for (let y = 18; y < 24; y++) for (let x = 18; x < 24; x++) full[y * side + x] = correction[y * side + x] = -1
  const point = { x: 0.01, y: 0.5, type: 'negative' }
  const result = selectMask(correction, [0.9], side, [point], undefined, { width: 1024, height: 1024 }, full, true, 0)
  assert(result.logits[stamp] > 0)
  assert(result.logits[genuineHole] < 0)
  assert(result.correctionSatisfied)
})

test('contorna logits com coordenadas subpixel, concavidades e furos na resolução original', () => {
  const side = 8
  const logits = new Float32Array(side * side).fill(-1)
  for (let y = 1; y < 6; y++) for (let x = 1; x < 7; x++) logits[y * side + x] = 2
  logits[3 * side + 3] = -2
  for (let y = 4; y < 6; y++) logits[y * side + 6] = -2
  const frame = { width: 320, height: 240 }
  const polygons = maskPolygons(logits, side, { width: 1024, height: 768 }, frame)
  const mask = rasterizeContour(polygons[0], frame.width, frame.height)
  assert.equal(polygons.length, 2)
  assert(polygons[0].some(({ x, y }) => !Number.isInteger(x) || !Number.isInteger(y)))
  assert.equal(mask[130 * frame.width + 260], 1)
  assert.equal(mask[200 * frame.width + 260], 0)
  assert(polygons[1].every(({ x, y }) => x > 115 && x < 165 && y > 115 && y < 165))
})
