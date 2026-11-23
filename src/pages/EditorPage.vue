<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { QBtn, QCard, QDialog, QSpinner } from 'quasar'
import { ChevronLeft, Download, Layers3, Plus, Redo2, Save, Share2, Undo2 } from '@lucide/vue'
import CompositionStage from '../components/CompositionStage.vue'
import CutoutEditor from '../components/CutoutEditor.vue'
import ExportDialog from '../components/ExportDialog.vue'
import ImageSource from '../components/ImageSource.vue'
import LayerInspector from '../components/LayerInspector.vue'
import { addLayer, adjustForMask, alterLayer, constrainTransform, createLayer, duplicateLayer, removeLayer, reorderLayer } from '../composables/projectModel.js'
import { useProject } from '../composables/useProject.js'
import { renderExport } from '../services/export.js'
import { decodeImage, importPhoto, releaseImage } from '../services/images.js'
import { saveProject, storageError } from '../services/projects.js'
import { clamp, fitSize } from '../utils/geometry.js'

const props = defineProps({ initial: { type: Object, required: true } })
const emit = defineEmits(['exit', 'notice'])
const state = useProject(props.initial)
const { project, dirty, canUndo, canRedo, assets, commit } = state
const activeAssets = computed(() => state.activeAssets(project.value))
const selected = ref()
const shadowDraft = shallowRef()
const cutout = shallowRef()
const source = ref(false)
const sourcePurpose = ref('object')
const inspectorOpen = ref(false)
const busy = ref('')
const showExport = ref(false)
const shareFirst = ref(false)
const exitDialog = ref(false)
const nameInput = ref()
let disposed = false

watch(project, (value) => {
  shadowDraft.value = undefined
  if (selected.value && !value.layers.some((layer) => layer.id === selected.value)) selected.value = undefined
})
watch(selected, () => { shadowDraft.value = undefined })

function openSource(purpose) {
  if (busy.value) return
  sourcePurpose.value = purpose
  source.value = true
}

async function handleSource(file) {
  const purpose = sourcePurpose.value
  busy.value = 'Abrindo fotografia…'
  try {
    const input = await importPhoto(file, purpose)
    if (disposed) {
      releaseImage(input.image)
      return
    }
    if (purpose === 'background') {
      assets.set(input.asset.id, input.asset)
      commit({ ...project.value, backgroundId: input.asset.id })
    } else {
      cutout.value = input
    }
  } catch (error) {
    emit('notice', error.message, true)
  } finally {
    busy.value = ''
  }
}

async function editMask(id) {
  if (busy.value) return
  const layer = project.value.layers.find((candidate) => candidate.id === id)
  const asset = assets.get(layer.assetId)
  busy.value = 'Abrindo a fotografia original…'
  try {
    const size = fitSize(asset.originalWidth ?? asset.width, asset.originalHeight ?? asset.height, 2400, 4_000_000)
    const image = await decodeImage(asset.blob, size)
    if (disposed) releaseImage(image)
    else cutout.value = { image, asset, layerId: id }
  } catch {
    emit('notice', 'Não foi possível abrir a fotografia original do objeto.', true)
  } finally {
    busy.value = ''
  }
}

function closeMask() {
  const image = cutout.value?.image
  cutout.value = undefined
  nextTick(() => releaseImage(image))
}

function insert(asset) {
  assets.set(asset.id, asset)
  const layerId = cutout.value?.layerId
  if (layerId) {
    const layer = project.value.layers.find((candidate) => candidate.id === layerId)
    const patch = adjustForMask(layer, assets.get(layer.assetId), asset, assets.get(project.value.backgroundId))
    commit(alterLayer(project.value, layerId, patch))
    selected.value = layerId
  } else {
    const layer = createLayer(asset)
    commit(addLayer(project.value, layer))
    selected.value = layer.id
  }
  closeMask()
  emit('notice', layerId ? 'Recorte atualizado.' : 'Objeto adicionado à montagem.')
}

function duplicate(id) {
  const next = duplicateLayer(project.value, id)
  if (next === project.value) return
  commit(next)
  selected.value = next.layers.at(-1).id
  emit('notice', 'Objeto duplicado.')
}

function transform(id, patch) {
  const current = project.value.layers.find((layer) => layer.id === id)
  if (current && Object.entries(patch).some(([key, value]) => current[key] !== value)) commit(alterLayer(project.value, id, patch))
}

function change(id, property, value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return
  const layer = project.value.layers.find((candidate) => candidate.id === id)
  if (!layer) return
  if (property === 'opacity') transform(id, { opacity: clamp(value, 0, 1) })
  else if (property === 'shadow') {
    shadowDraft.value = undefined
    if (JSON.stringify(layer.shadow) !== JSON.stringify(value)) transform(id, { shadow: value })
  }
  else transform(id, constrainTransform({ ...layer, [property]: value }))
}

function rename() {
  if (!nameInput.value) return
  const name = nameInput.value.value.trim() || 'Montagem sem título'
  nameInput.value.value = name
  if (name !== project.value.name) commit({ ...project.value, name })
}

async function save() {
  if (busy.value) return
  rename()
  const snapshot = project.value
  const data = state.activeAssets(snapshot)
  const background = data.get(snapshot.backgroundId)
  busy.value = 'Salvando montagem…'
  try {
    const thumbnail = await renderExport(snapshot, data, fitSize(background.width, background.height, 480), 'image/jpeg', 0.8)
      .catch(() => undefined)
    await saveProject(snapshot, data, thumbnail)
    state.markSaved(snapshot)
    emit('notice', 'Montagem salva neste dispositivo.')
  } catch (error) {
    emit('notice', storageError(error), true)
  } finally {
    busy.value = ''
  }
}

function exportDialog(share) {
  rename()
  shareFirst.value = share
  showExport.value = true
}

function requestExit() {
  rename()
  if (dirty.value) exitDialog.value = true
  else emit('exit')
}

function preventUnload(event) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function shortcuts(event) {
  if (cutout.value || busy.value || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) state.redo()
    else state.undo()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', preventUnload)
  window.addEventListener('keydown', shortcuts)
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('beforeunload', preventUnload)
  window.removeEventListener('keydown', shortcuts)
  releaseImage(cutout.value?.image)
})
</script>

<template>
  <main v-show="!cutout" class="editor-page" :inert="!!busy">
    <header class="editor-header">
      <div class="editor-identity">
        <QBtn flat round aria-label="Voltar às montagens" title="Voltar às montagens" @click="requestExit"><ChevronLeft :size="24" /></QBtn>
        <span class="editor-symbol editor-identity-mark"><Layers3 :size="22" /></span>
        <div class="editor-title">
          <input ref="nameInput" :value="project.name" maxlength="80" aria-label="Nome da montagem" @blur="rename" @keydown.enter="$event.target.blur()">
          <span>{{ dirty ? 'Alterações a salvar' : 'Salva no dispositivo' }}</span>
        </div>
      </div>
      <div class="editor-file-actions">
        <QBtn no-caps flat class="btn" aria-label="Salvar montagem" title="Salvar montagem" @click="save"><Save :size="19" /><span>Salvar</span></QBtn>
        <QBtn no-caps flat class="btn" aria-label="Compartilhar montagem" title="Compartilhar montagem" @click="exportDialog(true)"><Share2 :size="19" /><span>Compartilhar</span></QBtn>
        <QBtn no-caps unelevated class="btn btn-primary" aria-label="Exportar montagem" title="Exportar montagem" @click="exportDialog(false)"><Download :size="19" /><span>Exportar</span></QBtn>
      </div>
    </header>

    <div class="editor-toolbar">
      <QBtn no-caps unelevated class="btn btn-primary" @click="openSource('object')"><Plus :size="19" /> Adicionar objeto</QBtn>
      <div class="tool-group editor-history">
        <QBtn flat round aria-label="Desfazer" title="Desfazer" :disable="!canUndo" @click="state.undo()"><Undo2 :size="21" /></QBtn>
        <QBtn flat round aria-label="Refazer" title="Refazer" :disable="!canRedo" @click="state.redo()"><Redo2 :size="21" /></QBtn>
      </div>
    </div>

    <div class="editor-workspace">
      <CompositionStage :project="project" :assets="activeAssets" :selected :shadow-draft="shadowDraft" @select="selected = $event"
        @transform="transform" @error="emit('notice', $event, true)" />
      <LayerInspector :layers="project.layers" :selected :open="inspectorOpen" :shadow-draft="shadowDraft"
        @shadow-preview="(id, value) => shadowDraft = value ? { id, value } : undefined" @toggle="inspectorOpen = !inspectorOpen"
        @select="selected = $event" @add="openSource('object')" @replace="openSource('background')"
        @duplicate="duplicate" @delete="commit(removeLayer(project, $event))"
        @reorder="(id, delta) => commit(reorderLayer(project, id, delta))" @change="change" @mask="editMask" />
    </div>
  </main>

  <CutoutEditor v-if="cutout" :input="cutout" @cancel="closeMask" @confirm="insert" />
  <ImageSource v-model="source"
    :title="sourcePurpose === 'object' ? 'Adicionar objeto' : 'Trocar foto de fundo'"
    :hint="sourcePurpose === 'object' ? 'Escolha a fotografia do objeto que você quer recortar.' : 'Escolha uma nova fotografia para a área de montagem.'"
    @choose="handleSource" />
  <ExportDialog v-model="showExport" :project :assets="activeAssets" :share-first="shareFirst" @notice="emit('notice', $event)" />
  <QDialog v-model="exitDialog">
    <QCard class="dialog-card">
      <div class="dialog-head"><h2>Sair da montagem?</h2></div>
      <p>As alterações feitas desde o último salvamento serão descartadas.</p>
      <div class="dialog-actions">
        <QBtn no-caps flat class="btn" @click="exitDialog = false">Continuar editando</QBtn>
        <QBtn no-caps unelevated class="btn btn-danger" @click="emit('exit')">Sair sem salvar</QBtn>
      </div>
    </QCard>
  </QDialog>

  <div v-if="busy" class="busy-overlay" role="status"><QSpinner size="29px" />{{ busy }}</div>
</template>
