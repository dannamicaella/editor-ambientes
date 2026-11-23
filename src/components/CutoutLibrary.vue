<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { QBtn, QCard, QDialog, QSpinner } from 'quasar'
import { ArrowLeft, Image, Pencil, Plus, Trash2, X } from '@lucide/vue'
import NameDialog from './NameDialog.vue'
import { deleteCutout, listCutouts, openCutout, renameCutout, storageError } from '../services/projects.js'

const props = defineProps({ modelValue: Boolean, allowAdd: Boolean })
const emit = defineEmits(['update:modelValue', 'add'])
const cards = shallowRef([])
const preview = shallowRef()
const renaming = shallowRef()
const removing = shallowRef()
const busy = ref(false)
const error = ref('')
let revision = 0

function clearPreview() {
  if (preview.value) URL.revokeObjectURL(preview.value.url)
  preview.value = undefined
}

function setCards(entries) {
  for (const { url } of cards.value) if (url) URL.revokeObjectURL(url)
  cards.value = entries.map((entry) => ({ ...entry, url: entry.thumbnail && URL.createObjectURL(entry.thumbnail) }))
}

watch(() => props.modelValue, async (open) => {
  const current = ++revision
  clearPreview()
  setCards([])
  error.value = ''
  busy.value = open
  if (!open) return
  try {
    const entries = await listCutouts()
    if (current === revision) setCards(entries)
  } catch (problem) {
    if (current === revision) error.value = storageError(problem)
  } finally {
    if (current === revision) busy.value = false
  }
}, { immediate: true })

onBeforeUnmount(() => {
  revision++
  clearPreview()
  setCards([])
})

async function choose(id, add) {
  if (busy.value) return
  const current = revision
  busy.value = true
  error.value = ''
  try {
    const { entry, asset } = await openCutout(id)
    if (revision !== current) return
    if (add) {
      emit('update:modelValue', false)
      emit('add', asset, entry.name)
    } else {
      clearPreview()
      preview.value = { id, name: entry.name, url: URL.createObjectURL(asset.cutout), bounds: asset.bounds }
    }
  } catch (problem) {
    if (revision === current) error.value = storageError(problem)
  } finally {
    if (revision === current) busy.value = false
  }
}

async function rename(name) {
  const { id } = renaming.value
  await renameCutout(id, name)
  cards.value = cards.value.map((card) => card.id === id ? { ...card, name } : card)
  if (preview.value?.id === id) preview.value = { ...preview.value, name }
}

async function remove() {
  if (busy.value) return
  const { id } = removing.value
  busy.value = true
  error.value = ''
  try {
    await deleteCutout(id)
    const card = cards.value.find((item) => item.id === id)
    if (card?.url) URL.revokeObjectURL(card.url)
    cards.value = cards.value.filter((item) => item.id !== id)
    if (preview.value?.id === id) clearPreview()
  } catch (problem) {
    error.value = storageError(problem)
  } finally {
    removing.value = undefined
    busy.value = false
  }
}
</script>

<template>
  <QDialog :model-value="modelValue" :persistent="busy" @update:model-value="emit('update:modelValue', $event)">
    <QCard class="dialog-card library-dialog">
      <div class="dialog-head">
        <h2>Meus Recortes</h2>
        <QBtn flat round aria-label="Fechar" :disable="busy" @click="emit('update:modelValue', false)"><X :size="20" /></QBtn>
      </div>
      <p v-if="error" class="danger-text" role="alert">{{ error }}</p>
      <p v-if="busy" class="library-loading" role="status"><QSpinner size="21px" /> Acessando recortes…</p>
      <section v-if="preview" class="library-preview">
        <QBtn flat no-caps class="btn btn-text" @click="clearPreview"><ArrowLeft :size="17" /> Voltar aos recortes</QBtn>
        <h3>{{ preview.name }}</h3>
        <div class="transparent-preview"><img :src="preview.url" :alt="preview.name"></div>
        <p class="muted">{{ preview.bounds.width }} × {{ preview.bounds.height }} px</p>
        <QBtn v-if="allowAdd" unelevated no-caps class="btn btn-primary" :disable="busy" @click="choose(preview.id, true)">
          <Plus :size="17" /> Adicionar à montagem
        </QBtn>
      </section>
      <ul v-else-if="cards.length" class="library-grid">
        <li v-for="card in cards" :key="card.id" class="library-tile">
          <button type="button" class="tile-open" :aria-label="'Visualizar ' + card.name" :disabled="busy" @click="choose(card.id)">
            <span class="transparent-preview">
              <img v-if="card.url" :src="card.url" alt="" loading="lazy">
              <Image v-else :size="25" />
            </span>
            <strong>{{ card.name }}</strong>
          </button>
          <div class="library-actions">
            <QBtn v-if="allowAdd" flat no-caps class="btn btn-text library-add" :disable="busy" :aria-label="'Adicionar ' + card.name + ' à montagem'" @click="choose(card.id, true)">
              <Plus :size="16" /> Adicionar
            </QBtn>
            <QBtn flat round :disable="busy" :aria-label="'Renomear ' + card.name" title="Renomear" @click="renaming = card"><Pencil :size="16" /></QBtn>
            <QBtn flat round :disable="busy" :aria-label="'Excluir ' + card.name" title="Excluir" @click="removing = card"><Trash2 :size="16" /></QBtn>
          </div>
        </li>
      </ul>
      <div v-else-if="!busy && !error" class="empty-projects empty-library">
        <div class="empty-symbol"><Image :size="24" /></div>
        <strong>Nenhum recorte salvo</strong>
        <p>Use “Salvar em Meus Recortes” ao finalizar um recorte ou no painel da camada.</p>
      </div>
    </QCard>
  </QDialog>

  <NameDialog :model-value="Boolean(renaming)" :initial-name="renaming?.name" title="Renomear recorte"
    label="Nome do recorte" action="Salvar nome" :save="rename" @update:model-value="!$event && (renaming = undefined)" />
  <QDialog :model-value="Boolean(removing)" :persistent="busy" @update:model-value="!$event && (removing = undefined)">
    <QCard class="dialog-card">
      <div class="dialog-head"><h2>Excluir recorte?</h2></div>
      <p>“{{ removing?.name }}” será removido de Meus Recortes. As montagens salvas continuam com o objeto.</p>
      <div class="dialog-actions">
        <QBtn flat no-caps class="btn" :disable="busy" @click="removing = undefined">Cancelar</QBtn>
        <QBtn unelevated no-caps class="btn btn-danger" :loading="busy" @click="remove">Excluir recorte</QBtn>
      </div>
    </QCard>
  </QDialog>
</template>
