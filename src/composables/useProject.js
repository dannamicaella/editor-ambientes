import { computed, ref, shallowRef } from 'vue'
import { createHistory } from './history.js'
import { projectAssetIds } from './projectModel.js'

export { createProject } from './projectModel.js'

export function useProject(initial) {
  const history = createHistory(initial.project)
  const project = shallowRef(initial.project)
  const saved = shallowRef(initial.isNew ? null : initial.project)
  const assets = new Map(initial.assets)
  const revision = ref(0)
  const dirty = computed(() => saved.value !== project.value)
  const canUndo = computed(() => revision.value >= 0 && history.canUndo)
  const canRedo = computed(() => revision.value >= 0 && history.canRedo)

  function update(next) {
    project.value = next
    revision.value++
    const referenced = new Set(history.snapshots().flatMap((state) => [...projectAssetIds(state)]))
    for (const id of assets.keys()) {
      if (!referenced.has(id)) assets.delete(id)
    }
  }

  function commit(next) {
    update(history.commit(next))
  }

  function activeAssets(state) {
    return new Map([...projectAssetIds(state)].map((id) => [id, assets.get(id)]))
  }

  return {
    project, assets, dirty, canUndo, canRedo, commit, activeAssets,
    undo: () => update(history.undo()),
    redo: () => update(history.redo()),
    markSaved: (state) => { saved.value = state },
  }
}