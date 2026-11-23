let opening

const projectStores = ['summaries', 'projects', 'assets', 'media', 'cutouts']

function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('editor-de-ambientes', 2)
      let blocked = false
      request.onupgradeneeded = ({ oldVersion }) => {
        const db = request.result
        if (oldVersion === 0) {
          db.createObjectStore('summaries', { keyPath: 'id' })
          db.createObjectStore('projects', { keyPath: 'id' })
          const assets = db.createObjectStore('assets', { keyPath: ['projectId', 'id'] })
          assets.createIndex('projectId', 'projectId')
        }
        request.transaction.objectStore('assets').createIndex('sharedId', 'sharedId')
        db.createObjectStore('media', { keyPath: 'id' })
        db.createObjectStore('cutouts', { keyPath: 'id' }).createIndex('assetId', 'assetId')
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => {
        blocked = true
        reject(new Error('Feche as outras abas do editor e tente novamente.'))
      }
      request.onsuccess = () => {
        const db = request.result
        if (blocked) {
          db.close()
          return
        }
        db.onversionchange = () => {
          db.close()
          opening = undefined
        }
        resolve(db)
      }
    }).catch((error) => {
      opening = undefined
      throw error
    })
  }
  return opening
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function inTransaction(stores, mode, work) {
  const db = await database()
  const transaction = db.transaction(stores, mode)
  const complete = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error)
  })
  try {
    const [value] = await Promise.all([work((name) => transaction.objectStore(name)), complete])
    return value
  } catch (error) {
    try { transaction.abort() } catch { /* It already completed or aborted. */ }
    throw error
  }
}

function read(store, id) {
  return resultOf(store.get(id))
}

async function ensureMedia(store, asset) {
  if (await resultOf(store.getKey(asset.id)) === undefined) await resultOf(store.add(asset))
}

function ownedAssets(store, projectId) {
  return resultOf(store.index('projectId').getAll(projectId))
}

function inlineAsset({ projectId, ...asset }) {
  void projectId
  return asset
}

async function releaseMedia(get, id) {
  if (!id) return
  const [projects, cutouts] = await Promise.all([
    resultOf(get('assets').index('sharedId').count(id)),
    resultOf(get('cutouts').index('assetId').count(id)),
  ])
  if (!projects && !cutouts) await resultOf(get('media').delete(id))
}

function projectSummary(project, thumbnail) {
  return { id: project.id, name: project.name, thumbnail, updatedAt: Date.now(), count: project.layers.length }
}

async function requireProject(store, id) {
  const project = await read(store, id)
  if (!project) throw new Error('Esta montagem foi removida do dispositivo.')
  return project
}

export async function listProjects() {
  const db = await database()
  const summaries = await resultOf(db.transaction('summaries').objectStore('summaries').getAll())
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function openProject(id) {
  return inTransaction(['projects', 'assets', 'media'], 'readonly', async (get) => {
    const [project, entries] = await Promise.all([requireProject(get('projects'), id), ownedAssets(get('assets'), id)])
    const assets = await Promise.all(entries.map(async (entry) => {
      const asset = entry.sharedId ? await read(get('media'), entry.sharedId) : inlineAsset(entry)
      if (!asset) throw new Error('Uma imagem desta montagem está indisponível.')
      return [entry.id, asset]
    }))
    return { project, assets: new Map(assets) }
  })
}

export function saveProject(project, assets, thumbnail) {
  return inTransaction(projectStores, 'readwrite', async (get) => {
    const { id } = project
    const store = get('assets')
    const existing = await ownedAssets(store, id)
    await Promise.all([...assets.values()].map(async (asset) => {
      await ensureMedia(get('media'), asset)
      await resultOf(store.put({ projectId: id, id: asset.id, sharedId: asset.id }))
    }))
    const removed = existing.filter((entry) => !assets.has(entry.id))
    await Promise.all(removed.map((entry) => resultOf(store.delete([id, entry.id]))))
    await Promise.all(removed.map(({ sharedId }) => releaseMedia(get, sharedId)))
    await Promise.all([
      resultOf(get('projects').put(project)),
      resultOf(get('summaries').put(projectSummary(project, thumbnail))),
    ])
  })
}

export const PROJECT_NAME_LIMIT = 80

export function duplicateProject(id, newId = crypto.randomUUID()) {
  return inTransaction(projectStores, 'readwrite', async (get) => {
    const projects = get('projects')
    const assets = get('assets')
    const [copy, summary, entries] = await Promise.all([
      requireProject(projects, id), read(get('summaries'), id), ownedAssets(assets, id),
    ])
    const suffix = ' - Cópia'
    copy.name = copy.name.slice(0, PROJECT_NAME_LIMIT - suffix.length).trimEnd() + suffix
    copy.id = newId
    await Promise.all(entries.map(async (entry) => {
      const sharedId = entry.sharedId ?? entry.id
      if (!entry.sharedId) {
        await ensureMedia(get('media'), inlineAsset(entry))
        await resultOf(assets.put({ projectId: id, id: entry.id, sharedId }))
      }
      await resultOf(assets.add({ projectId: newId, id: entry.id, sharedId }))
    }))
    await Promise.all([
      resultOf(projects.add(copy)),
      resultOf(get('summaries').add(projectSummary(copy, summary?.thumbnail))),
    ])
    return copy
  })
}

export function renameProject(id, name) {
  return inTransaction(['projects', 'summaries'], 'readwrite', async (get) => {
    const [project, summary] = await Promise.all([requireProject(get('projects'), id), read(get('summaries'), id)])
    await Promise.all([
      resultOf(get('projects').put({ ...project, name })),
      resultOf(get('summaries').put(projectSummary({ ...project, name }, summary?.thumbnail))),
    ])
  })
}

export function deleteProject(id) {
  return inTransaction(projectStores, 'readwrite', async (get) => {
    const assets = get('assets')
    const entries = await ownedAssets(assets, id)
    await Promise.all([
      resultOf(get('summaries').delete(id)),
      resultOf(get('projects').delete(id)),
      ...entries.map((entry) => resultOf(assets.delete([id, entry.id]))),
    ])
    await Promise.all(entries.map(({ sharedId }) => releaseMedia(get, sharedId)))
  })
}

export async function listCutouts() {
  const db = await database()
  const entries = await resultOf(db.transaction('cutouts').objectStore('cutouts').getAll())
  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

async function requireCutout(store, id) {
  const entry = await read(store, id)
  if (!entry) throw new Error('Este recorte foi removido da biblioteca.')
  return entry
}

export function openCutout(id) {
  return inTransaction(['cutouts', 'media'], 'readonly', async (get) => {
    const entry = await requireCutout(get('cutouts'), id)
    const asset = await read(get('media'), entry.assetId)
    if (!asset?.cutout) throw new Error('A imagem deste recorte está indisponível.')
    return { entry, asset }
  })
}

export function saveCutout(asset, name, thumbnail) {
  return inTransaction(['cutouts', 'media'], 'readwrite', async (get) => {
    const entry = { id: crypto.randomUUID(), assetId: asset.id, name, thumbnail, createdAt: Date.now() }
    await ensureMedia(get('media'), asset)
    await resultOf(get('cutouts').add(entry))
    return entry
  })
}

export function renameCutout(id, name) {
  return inTransaction(['cutouts'], 'readwrite', async (get) => {
    const store = get('cutouts')
    const entry = await requireCutout(store, id)
    await resultOf(store.put({ ...entry, name }))
  })
}

export function deleteCutout(id) {
  return inTransaction(['cutouts', 'media', 'assets'], 'readwrite', async (get) => {
    const store = get('cutouts')
    const entry = await requireCutout(store, id)
    await resultOf(store.delete(id))
    await releaseMedia(get, entry.assetId)
  })
}

export function storageError(error) {
  if (error?.name === 'QuotaExceededError') return 'Falta espaço no armazenamento. Libere espaço no dispositivo e tente salvar novamente.'
  if (error?.name === 'SecurityError') return 'O navegador bloqueou o armazenamento local. Confira as permissões deste site.'
  if (error?.name === 'Error') return error.message
  return 'Não foi possível acessar o armazenamento local. Tente novamente.'
}
