import assert from 'node:assert/strict'
import test from 'node:test'
import { imageHeader } from '../src/utils/imageHeader.js'

test('identifica dimensões PNG, JPEG e WebP antes de decodificar', () => {
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 128, 0, 0, 1, 224)
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xc2, 0, 7, 8, 1, 224, 2, 128)
  const webp = new Uint8Array(30)
  webp.set(Buffer.from('RIFF'), 0)
  webp.set(Buffer.from('WEBPVP8X'), 8)
  webp.set([127, 2, 0, 223, 1, 0], 24)
  for (const [format, buffer] of [['png', png], ['jpeg', jpeg], ['webp', webp]]) {
    assert.deepEqual(imageHeader(buffer.buffer), { format, width: 640, height: 480 })
  }
})

test('deixa um JPEG com metadados além da amostra para o decodificador e rejeita outros tipos', () => {
  assert.deepEqual(imageHeader(Uint8Array.of(255, 216, 255, 225, 255, 255).buffer), { format: 'jpeg' })
  assert.equal(imageHeader(Uint8Array.from(Buffer.from('<svg')).buffer), null)
})