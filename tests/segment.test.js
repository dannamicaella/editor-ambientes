import assert from 'node:assert/strict'
import test from 'node:test'
import { bestMask, guideBox, guidedRegion, modelPrompts, prefersMask, relativePrompts, resizedImage, samAlpha, samLogitAt, selectMask, unpadLogits, updatePrompt } from '../src/services/mobileSamGeometry.js'
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

test('um único Manter preserva o objeto quando a interpolação do toque oscila na borda da célula', () => {
  const side = 8
  const area = side * side
  const logits = new Float32Array(2 * area).fill(-10)
  for (let y = 1; y <= 6; y++) {
    for (let x = 1; x <= 6; x++) logits[y * side + x] = 2
  }
  logits[area + 4 * side] = 2
  logits[area + 4 * side + 1] = 2
  const size = { width: 1024, height: 1024 }
  const point = { x: 1.05 / side, y: 4.5 / side, type: 'positive' }
  assert(samLogitAt(logits.subarray(0, area), side, size, point) < 0)
  const result = selectMask(logits, [0.95, 0.8], side, [point], undefined, size)
  const alpha = samAlpha(result.logits, side, size, { width: 320, height: 320 })
  assert.equal(result.candidate, 0)
  assert.equal(result.logits.filter((value) => value > 0).length, 36)
  assert.equal(alphaAt(alpha, 175, 175), 255)
})

test('usa margem no contorno guia e projeta a máscara de volta ao local exato da foto', () => {
  const region = guidedRegion(1000, 1000, { x: 0.3, y: 0.3, right: 0.7, bottom: 0.7 })
  const { points } = relativePrompts([{ x: 0.5, y: 0.5, type: 'positive' }, { x: 0, y: 0, type: 'negative' }], undefined, region)
  assert.equal(points.length, 1)
  assert(Math.abs(points[0].x - 0.5) <= 0.001)
  const alpha = samAlpha(Float32Array.of(1, 1, 1, 1), 2, { width: 1024, height: 1024 },
    { width: 1000, height: 1000 }, region)
  assert.equal(alpha.x, region.x * 1000)
  assert.equal(alpha.width, region.width * 1000)
  assert.equal(alphaAt(alpha, alpha.x, alpha.y), 255)
  assert.equal(alphaAt(alpha, alpha.x - 1, alpha.y), 0)
})

test('caixa guia admite indicação Manter fora da linha e não cria pontos artificiais', () => {
  const box = { x: 0.25, y: 0.25, right: 0.75, bottom: 0.75 }
  const size = { width: 683, height: 1024 }
  const clean = guideBox([], box)
  assert.deepEqual([...modelPrompts([], clean, size).labels], [2, 3])
  const point = { x: 0.8, y: 0.5, type: 'positive' }
  assert.equal(guideBox([point], box), undefined)
  assert.deepEqual([...modelPrompts([point], guideBox([point], box), size).labels], [1, -1])
})

test('projeta bordas fracionárias da região sem preencher pixels fora dela', () => {
  const mask = samAlpha(Float32Array.of(1), 1, { width: 1024, height: 1024 },
    { width: 20, height: 20 }, { x: 0.075, y: 0.075, width: 0.8, height: 0.8 })
  assert.equal(alphaAt(mask, 1, 1), 64)
  assert.equal(alphaAt(mask, 17, 2), 128)
  assert.equal(alphaAt(mask, 0, 2), 0)
  assert.equal(alphaAt(mask, 2, 2), 255)
})

test('a correção explícita tem prioridade sobre escores maiores e permite recorrer sem logits anteriores', () => {
  const honored = { correctionSatisfied: true, score: -8 }
  const failed = { correctionSatisfied: false, score: 1 }
  assert(prefersMask(honored, failed))
  assert(!prefersMask(failed, honored))
  assert(prefersMask(honored, undefined))
})

test('faz a interpolação na grade com padding antes de recortar a área útil', () => {
  const size = { width: 300, height: 576 }
  const source = Float32Array.of(1, 9, 3, 11)
  const image = unpadLogits(source, 2, size)
  const position = { x: 299.5 / size.width, y: 575.5 / size.height }
  const expected = 1 + 8 * (299.5 / 512 - 0.5) + 2 * (575.5 / 512 - 0.5)
  assert(Math.abs(image.at(-1) - expected) < 1e-6)
  assert(Math.abs(samLogitAt(source, 2, size, position) - expected) < 1e-6)
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

function alphaAt(mask, x, y) {
  if (x < mask.x || y < mask.y || x >= mask.x + mask.width || y >= mask.y + mask.height) return 0
  const pixels = new Uint8ClampedArray(mask.width * 4)
  mask.writeAlpha(pixels, y - mask.y)
  return pixels[4 * (x - mask.x) + 3]
}

test('rasteriza alfa na resolução original com concavidades, furos e antialiasing', () => {
  const side = 8
  const logits = new Float32Array(side * side).fill(-1)
  for (let y = 1; y < 6; y++) for (let x = 1; x < 7; x++) logits[y * side + x] = 2
  logits[3 * side + 3] = -2
  for (let y = 4; y < 6; y++) logits[y * side + 6] = -2
  const frame = { width: 320, height: 240 }
  const mask = samAlpha(logits, side, { width: 1024, height: 768 }, frame)
  assert.equal(alphaAt(mask, 225, 135), 255)
  assert.equal(alphaAt(mask, 260, 195), 0)
  assert.equal(alphaAt(mask, 140, 140), 0)
  assert.equal(alphaAt(mask, 100, 140), 255)
  const values = Array.from({ length: frame.width }, (_, x) => alphaAt(mask, x, 100))
  assert(values.some((alpha) => alpha > 0 && alpha < 255))
})

test('preserva apêndices finos e regiões desconectadas da máscara selecionada', () => {
  const side = 16
  const logits = new Float32Array(side * side).fill(-1)
  for (let y = 4; y < 12; y++) for (let x = 3; x < 10; x++) logits[y * side + x] = 3
  for (let x = 10; x <= 13; x++) logits[8 * side + x] = 3
  logits[2 * side + 12] = 3
  const mask = samAlpha(logits, side, { width: 1024, height: 1024 }, { width: 320, height: 320 })
  assert.equal(alphaAt(mask, 270, 170), 255)
  assert.equal(alphaAt(mask, 250, 50), 255)
  assert.equal(alphaAt(mask, 270, 195), 0)
})
