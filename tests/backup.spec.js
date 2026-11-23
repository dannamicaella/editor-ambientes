import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { encodeBackup, inspectBackup, verifyBackup } from '../src/services/backup.js'

const databaseName = 'editor-de-ambientes'
const backupTitle = 'Backup e Restauração'
const stores = ['projects', 'summaries', 'assets', 'media', 'cutouts', 'imports']

async function seedVersionTwo(page) {
  await page.route('**/backup-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Banco v2</title>' }))
  await page.goto('/backup-fixture')
  await page.evaluate(async (databaseName) => {
    async function photo(width, height, inset = 0) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.fillStyle = '#cc6644'
      context.fillRect(inset, inset, width - inset * 2, height - inset * 2)
      return new Promise((resolve) => canvas.toBlob(resolve))
    }
    const [background, original, cutout] = await Promise.all([photo(140, 100), photo(32, 32), photo(24, 20, 2)])
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open(databaseName, 2)
      opening.onupgradeneeded = () => {
        const db = opening.result
        const projects = db.createObjectStore('projects', { keyPath: 'id' })
        const summaries = db.createObjectStore('summaries', { keyPath: 'id' })
        const media = db.createObjectStore('media', { keyPath: 'id' })
        const assets = db.createObjectStore('assets', { keyPath: ['projectId', 'id'] })
        assets.createIndex('projectId', 'projectId')
        assets.createIndex('sharedId', 'sharedId')
        const library = db.createObjectStore('cutouts', { keyPath: 'id' })
        library.createIndex('assetId', 'assetId')
        media.add({ id: 'fundo', width: 140, height: 100, blob: background })
        const bounds = { x: 2, y: 3, width: 24, height: 20 }
        media.add({
          id: 'imagem', name: 'Objeto original', width: 32, height: 32, originalWidth: 32, originalHeight: 32,
          blob: original, cutout, mask: cutout, bounds, maskRegion: bounds,
        })
        library.add({ id: 'recorte', assetId: 'imagem', name: 'Meu objeto', createdAt: 100, thumbnail: cutout })
        for (const [id, name, count] of [['primeira', 'Sala A', 2], ['segunda', 'Sala B', 1]]) {
          const shadow = { enabled: true, opacity: 33, blur: 4, x: 2, y: 6, color: '#112233', contact: 45 }
          const layers = Array.from({ length: count }, (_, i) => ({
            id: 'camada-' + i, name: 'Objeto ' + i, assetId: 'imagem', x: .5 + i * .12, y: .44, scale: .37, rotation: 28, opacity: .76, shadow,
          }))
          const backgroundId = id === 'primeira' ? 'fundo' : 'fundo-antigo'
          projects.add({ id, name, backgroundId, layers })
          summaries.add({ id, name, count, updatedAt: 100, thumbnail: background })
          if (backgroundId === 'fundo-antigo') {
            assets.add({ projectId: id, id: backgroundId, width: 140, height: 100, blob: background })
          } else assets.add({ projectId: id, id: backgroundId, sharedId: backgroundId })
          assets.add({ projectId: id, id: 'imagem', sharedId: 'imagem' })
        }
      }
      opening.onsuccess = () => { opening.result.close(); resolve() }
      opening.onerror = () => reject(opening.error)
    })
  }, databaseName)
}

async function readState(page) {
  return page.evaluate(async ({ databaseName, stores }) => {
    const read = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const db = await read(indexedDB.open(databaseName))
    try {
      const transaction = db.transaction(stores)
      const data = await Promise.all(stores.map((name) => read(transaction.objectStore(name).getAll())))
      const state = Object.fromEntries(stores.map((name, index) => [name, data[index]]))
      const hash = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      state.media = await Promise.all(state.media.map(async ({ blob, cutout, mask, ...metadata }) => ({
        ...metadata, blob: await hash(blob), ...(cutout && { cutout: await hash(cutout), mask: await hash(mask) }),
      })))
      state.assets = await Promise.all(state.assets.map(async ({ blob, ...metadata }) => ({
        ...metadata, ...(blob && { blob: await hash(blob) }),
      })))
      for (const name of ['summaries', 'cutouts']) {
        state[name] = await Promise.all(state[name].map(async ({ thumbnail, ...metadata }) => ({
          ...metadata, ...(thumbnail && { thumbnail: await hash(thumbnail) }),
        })))
      }
      return { ...state, version: db.version }
    } finally {
      db.close()
    }
  }, { databaseName, stores })
}

async function openPanel(page) {
  await page.getByRole('button', { name: backupTitle, exact: true }).click()
  const panel = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: backupTitle }) })
  await expect(panel).toBeVisible()
  return panel
}

async function select(panel, buffer, name = 'dados.eabackup') {
  await panel.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
}

function report(projects, ignoredProjects, cutouts, ignoredCutouts, conflicts) {
  return `Montagens adicionadas: ${projects}. Montagens ignoradas: ${ignoredProjects}. Recortes adicionados: ${cutouts}. Recortes ignorados: ${ignoredCutouts}. Conflitos de ID resolvidos: ${conflicts}.`
}

function summary(panel, ...counts) {
  return panel.getByText(report(...counts))
}

test('restaura offline a 360 px, ignora conteúdo repetido e preserva versões modificadas', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, baseURL })
  try {
    await context.addInitScript(() => {
      window.estimateCalls = 0
      Object.defineProperty(navigator.storage, 'estimate', {
        value: async () => {
          window.estimateCalls++
          return { usage: 10, quota: 12 }
        },
      })
    })
    const page = await context.newPage()
    const ai = []
    page.on('request', (request) => { if (request.url().includes('/ai/')) ai.push(request.url()) })
    await seedVersionTwo(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible()
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Abrir montagem Sala A' })).toHaveCount(1)
    const original = await readState(page)
    expect(original.version).toBe(3)
    expect(await page.evaluate(() => window.estimateCalls)).toBe(0)
    const panel = await openPanel(page)
    await expect(panel.getByText(/cache offline e os arquivos da IA/)).toBeVisible()
    expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(360)
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Exportar backup' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.eabackup$/)
    const backup = await readFile(await download.path())
    await select(panel, backup)
    await expect(panel.getByText(/A restauração pode falhar por falta de espaço/)).toBeVisible()
    await panel.getByRole('button', { name: 'Confirmar restauração' }).click()
    await expect(summary(panel, 0, 2, 0, 1, 0)).toBeVisible()
    expect(await readState(page)).toEqual(original)

    await page.reload()
    const reopened = await openPanel(page)
    await select(reopened, backup, 'backup-renomeado.eabackup')
    await reopened.getByRole('button', { name: 'Confirmar restauração' }).click()
    await expect(summary(reopened, 0, 2, 0, 1, 0)).toBeVisible()
    expect(await readState(page)).toEqual(original)

    const snapshot = await verifyBackup(await inspectBackup(new Blob([backup])))
    const [first, second] = snapshot.groups
    const [entry] = snapshot.cutouts
    const object = snapshot.media.find(({ id }) => id === entry.assetId)
    const foreground = { ...object, id: 'outra-referencia' }
    const differentMask = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 24
      canvas.height = 20
      canvas.getContext('2d').fillRect(4, 4, 10, 12)
      return canvas.toDataURL().split(',')[1]
    })
    const layers = first.project.layers.map((layer, index) => ({
      ...layer, assetId: foreground.id, ...(index === 0 && { shadow: { ...layer.shadow, contact: 72 } }),
    }))
    const archive = await encodeBackup({
      groups: [
        { ...first, project: { ...first.project, layers } },
        {
          project: {
            ...second.project, id: 'sala-b-com-outro-id',
            layers: second.project.layers.map((layer) => ({ ...layer, id: 'outro-id', assetId: foreground.id })),
          },
          summary: { ...second.summary, id: 'sala-b-com-outro-id', updatedAt: 400 },
        },
        {
          project: { ...first.project, id: 'terceira', name: 'Sala C' },
          summary: { ...first.summary, id: 'terceira', name: 'Sala C' },
        },
      ],
      media: [
        ...snapshot.media.filter(({ id }) => id !== object.id), foreground,
        { ...object, mask: new Blob([Buffer.from(differentMask, 'base64')], { type: 'image/png' }) },
      ],
      cutouts: [entry, { ...entry, id: 'apelido', assetId: foreground.id, createdAt: 400 }],
    })
    const modified = Buffer.from(await archive.arrayBuffer())
    await select(reopened, modified)
    await reopened.getByRole('button', { name: 'Confirmar restauração' }).click()
    await expect(summary(reopened, 2, 1, 1, 1, 3)).toBeVisible()
    const restored = await readState(page)
    expect(restored.projects).toHaveLength(4)
    expect(restored.cutouts).toHaveLength(2)
    expect(restored.media).toHaveLength(3)
    for (const store of ['projects', 'summaries', 'assets', 'media', 'cutouts']) {
      expect(restored[store]).toEqual(expect.arrayContaining(original[store]))
    }
    const variant = restored.projects.find(({ id, name }) => id !== first.project.id && name === first.project.name)
    expect(variant.layers[0].shadow.contact).toBe(72)
    expect(variant.layers.map(({ assetId }) => assetId)).toEqual(['imagem', 'imagem'])
    const addedImage = restored.cutouts.find(({ id }) => id !== entry.id).assetId
    expect(addedImage).not.toBe(entry.assetId)
    expect(restored.projects.find(({ id }) => id === 'terceira').layers.map(({ assetId }) => assetId)).toEqual([addedImage, addedImage])
    expect(restored.media.find(({ id }) => id === addedImage).mask).not.toEqual(original.media.find(({ id }) => id === 'imagem').mask)
    await select(reopened, modified)
    await reopened.getByRole('button', { name: 'Confirmar restauração' }).click()
    await expect(summary(reopened, 0, 3, 0, 2, 0)).toBeVisible()
    expect(await readState(page)).toEqual(restored)
    await reopened.getByRole('button', { name: 'Fechar' }).click()
    await page.getByRole('button', { name: 'Abrir montagem Sala A' }).first().click()
    await expect(page.getByText('Salva no dispositivo')).toBeVisible()
    await expect(page.locator('.layer-row')).toHaveCount(2)
    expect(ai).toEqual([])
  } finally {
    await context.close()
  }
})

test('recusa arquivos inválidos, reverte falha de quota e evita duplicação em duas abas', async ({ page }) => {
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKZ0AAAAASUVORK5CYII=', 'base64')])
  const backup = Buffer.from(await (await encodeBackup({
    groups: [{
      project: { id: 'new', name: 'Restaurada', backgroundId: 'bg', layers: [] },
      summary: { id: 'new', name: 'Restaurada', count: 0, updatedAt: 100 },
    }],
    media: [{ id: 'bg', width: 1, height: 1, blob: png }],
    cutouts: [],
  })).arrayBuffer())
  await page.goto('/')
  await expect(page.getByText('Nenhuma montagem por aqui')).toBeVisible()
  const panel = await openPanel(page)
  const before = await readState(page)
  await select(panel, Buffer.alloc(64))
  await expect(panel.getByRole('alert')).toContainText('não é um backup')
  expect(await readState(page)).toEqual(before)

  const corrupted = Buffer.from(backup)
  corrupted[corrupted.length - 1] ^= 1
  await select(panel, corrupted)
  await panel.getByRole('button', { name: 'Confirmar restauração' }).click()
  await expect(panel.getByRole('alert')).toContainText('Uma imagem do backup foi corrompida')
  expect(await readState(page)).toEqual(before)

  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value) {
      if (this.name === 'imports') {
        IDBObjectStore.prototype.put = put
        throw new DOMException('Limite de teste', 'QuotaExceededError')
      }
      return put.call(this, value)
    }
  })
  await select(panel, backup)
  await panel.getByRole('button', { name: 'Confirmar restauração' }).click()
  await expect(panel.getByRole('alert')).toContainText('A importação foi desfeita')
  expect(await readState(page)).toEqual(before)
  const other = await page.context().newPage()
  await other.goto('/')
  const otherPanel = await openPanel(other)
  await select(otherPanel, backup)
  await Promise.all([panel, otherPanel].map((dialog) => dialog.getByRole('button', { name: 'Confirmar restauração' }).click()))
  const reports = await Promise.all([panel, otherPanel].map((dialog) => dialog.getByText(/^Montagens adicionadas:/).textContent()))
  expect(reports).toEqual(expect.arrayContaining([report(1, 0, 0, 0, 0), report(0, 1, 0, 0, 0)]))
  const after = await readState(page)
  expect(after.projects).toHaveLength(1)
  expect(after.assets).toHaveLength(1)
  expect(after.media).toHaveLength(1)
  expect(after.imports).toHaveLength(1)
})

