import assert from 'node:assert/strict'
import test from 'node:test'
import { backupCounts, encodeBackup, inspectBackup, verifyBackup } from '../src/services/backup.js'
import { contentFingerprints, planBackupMerge } from '../src/services/backupContent.js'

const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' })
const asset = { id: 'object', width: 1, height: 1, name: 'Objeto', blob: png, cutout: png, mask: png, bounds: { x: 0, y: 0, width: 1, height: 1 } }
const group = {
  project: {
    id: 'project', name: 'Projeto', backgroundId: 'background',
    layers: [{ id: 'layer', name: 'Camada', assetId: 'object', scale: .36, x: .5, y: .5, opacity: .8, rotation: 16, shadow: true }],
  },
  summary: { id: 'project', name: 'Projeto', count: 1, updatedAt: 21, thumbnail: png },
}
const record = { id: 'cutout', assetId: 'object', name: 'Recorte', createdAt: 24, thumbnail: png }
const snapshot = { groups: [group], media: [{ id: 'background', width: 1, height: 1, blob: png }, asset], cutouts: [record] }

async function withManifest(file, update) {
  const header = new Uint8Array(await file.slice(0, 48).arrayBuffer())
  const view = new DataView(header.buffer)
  const end = 48 + view.getUint32(12)
  const manifest = JSON.parse(await file.slice(48, end).text())
  update(manifest)
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  view.setUint32(12, bytes.length)
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), 16)
  return new Blob([header, bytes, file.slice(end)])
}

test('preserva metadados, bytes de imagem e compartilhamento no backup', async () => {
  const backup = await encodeBackup(snapshot)
  const imported = await inspectBackup(backup)
  assert.deepEqual(backupCounts(imported), { projects: 1, cutouts: 1 })
  assert.equal(imported.fingerprint, (await inspectBackup(await encodeBackup(snapshot))).fingerprint)
  assert.equal(imported.manifest.blobs.length, 1)
  const restored = await verifyBackup(imported)
  assert.deepEqual(restored.groups[0].project, group.project)
  assert.equal(restored.groups[0].summary.updatedAt, 21)
  assert.equal(restored.media[1].cutout, restored.cutouts[0].thumbnail)
  assert.deepEqual(await restored.media[1].mask.arrayBuffer(), await png.arrayBuffer())
  assert.equal(restored.media[1].cutout.type, 'image/png')
})

test('recusa arquivo incompatível, truncado ou com checksum inválido', async () => {
  const backup = await encodeBackup(snapshot)
  await assert.rejects(inspectBackup(new Blob(['inválido'])), /não é um backup/)
  const version = new Uint8Array(await backup.slice(0, 48).arrayBuffer())
  new DataView(version.buffer).setUint32(8, 19)
  await assert.rejects(inspectBackup(new Blob([version, backup.slice(48)])), /versão .* incompatível/)
  await assert.rejects(inspectBackup(backup.slice(0, -1)), /incompleto/)
  await assert.rejects(inspectBackup(new Blob([backup.slice(0, 50), new Uint8Array([0]), backup.slice(51)])), /metadados .* corrompidos/)
  const badImage = new Blob([backup.slice(0, -1), new Uint8Array([255])])
  await assert.rejects(verifyBackup(await inspectBackup(badImage)), /imagem .* corrompida/)
})

test('recusa referências quebradas, registros duplicados e blobs órfãos mesmo com manifesto íntegro', async () => {
  const backup = await encodeBackup(snapshot)
  for (const mutate of [
    (manifest) => { manifest.groups[0].project.layers[0].assetId = 'ausente' },
    (manifest) => { manifest.cutouts[0].assetId = 'background' },
    (manifest) => { manifest.media.push(manifest.media[0]) },
    (manifest) => { manifest.blobs.push(manifest.blobs[0]) },
    (manifest) => { manifest.media[1].cutout = 500 },
  ]) {
    await assert.rejects(inspectBackup(await withManifest(backup, mutate)), /referências incompletas/)
  }
})

test('lê payloads grandes em blocos de até 1 MiB na exportação e na verificação', async () => {
  const size = 1024 ** 2
  const large = new Blob([png, new Uint8Array(size * 2 + 13)])
  const media = snapshot.media.map((record) => ({ ...record, blob: large }))
  const exported = []
  const backup = await encodeBackup({ ...snapshot, media }, (done) => exported.push(done))
  const imported = []
  await verifyBackup(await inspectBackup(backup), (done) => imported.push(done))
  assert.deepEqual(exported, imported)
  assert.equal(exported.at(-1), png.size + large.size)
  assert(exported.every((total, index) => total - (exported[index - 1] ?? 0) <= size))
})

test('compara registros completos sem depender de IDs, ordem de campos, datas ou miniaturas', async () => {
  const original = structuredClone(snapshot)
  original.groups[0].project.additional = { enabled: true, values: [2, 3] }
  original.groups[0].project.layers[0].additional = { mode: 'fine', strength: 42 }
  original.media[1].additional = { left: 10, right: 12 }
  original.cutouts[0].additional = { kind: 'object' }
  const relocated = structuredClone(original)
  const { project, summary } = relocated.groups[0]
  project.id = 'different-project'
  project.additional = { values: [2, 3], enabled: true }
  project.backgroundId = 'different-background'
  project.layers[0].id = 'different-layer'
  project.layers[0].assetId = 'different-object'
  project.layers[0].additional = { strength: 42, mode: 'fine' }
  Object.assign(summary, { id: project.id, updatedAt: 100, thumbnail: undefined })
  relocated.media[0].id = 'different-background'
  Object.assign(relocated.media[1], { id: 'different-object', additional: { right: 12, left: 10 } })
  Object.assign(relocated.cutouts[0], { id: 'different-cutout', assetId: 'different-object', createdAt: 500, thumbnail: undefined })
  const local = await contentFingerprints(original)
  const incoming = await contentFingerprints(relocated)
  assert.equal(local.projects.get('project'), incoming.projects.get(project.id))
  assert.equal(local.cutouts.get('cutout'), incoming.cutouts.get('different-cutout'))
  assert.equal(local.media.get('object'), incoming.media.get('different-object'))
  const shared = new Set(['background', 'object'])
  const unchanged = planBackupMerge(relocated, incoming, local, shared)
  assert.equal(unchanged.ignoredProjects, 1)
  assert.equal(unchanged.ignoredCutouts, 1)
  assert.deepEqual(unchanged.media, [])

  project.layers[0].additional.strength = 43
  relocated.cutouts[0].additional.kind = 'variant'
  const changed = planBackupMerge(relocated, await contentFingerprints(relocated), local, shared)
  assert.equal(changed.groups.length, 1)
  assert.equal(changed.cutouts.length, 1)
  assert.deepEqual(changed.media, [])
  assert.deepEqual([...changed.reused], [['different-background', 'background'], ['different-object', 'object']])
  project.additional.values.reverse()
  relocated.media[1].additional.left = 11
  const distinct = await contentFingerprints(relocated)
  assert.notEqual(distinct.media.get('different-object'), local.media.get('object'))
  assert.notEqual(distinct.projects.get(project.id), incoming.projects.get(project.id))
})

