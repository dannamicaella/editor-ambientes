<script setup>
import { onMounted, ref, shallowRef } from 'vue'
import { QBtn, QCard, QDialog, QSpinner } from 'quasar'
import { Check, CircleAlert, X } from '@lucide/vue'
import HomePage from './pages/HomePage.vue'
import EditorPage from './pages/EditorPage.vue'
import ImageSource from './components/ImageSource.vue'
import CutoutLibrary from './components/CutoutLibrary.vue'
import NameDialog from './components/NameDialog.vue'
import { importPhoto } from './services/images.js'
import { deleteProject, duplicateProject, listProjects, openProject, renameProject, storageError } from './services/projects.js'
import { canInstall, installApp, offlineStatus, setupPwa } from './services/pwa.js'
import { createProject } from './composables/useProject.js'

const summaries = shallowRef([])
const editor = shallowRef()
const loading = ref(true)
const busy = ref('')
const notice = ref()
const source = ref(false)
const help = ref(false)
const library = ref(false)
const renaming = shallowRef()
const removing = shallowRef()
let noticeTimer

function notify(message, error = false) {
  clearTimeout(noticeTimer)
  notice.value = { message, error }
  if (!error) noticeTimer = setTimeout(() => { notice.value = undefined }, 4500)
}

async function refresh() {
  try {
    summaries.value = await listProjects()
  } catch (error) {
    notify(storageError(error), true)
  } finally {
    loading.value = false
  }
}

async function start(file) {
  busy.value = 'Abrindo fotografia…'
  try {
    const { asset } = await importPhoto(file, 'background')
    editor.value = createProject(asset)
  } catch (error) {
    notify(error.message, true)
  } finally {
    busy.value = ''
  }
}

async function reopen(id) {
  if (busy.value) return
  busy.value = 'Abrindo montagem…'
  try {
    editor.value = await openProject(id)
  } catch (error) {
    notify(storageError(error), true)
  } finally {
    busy.value = ''
  }
}

async function remove() {
  if (!removing.value || busy.value) return
  const { id } = removing.value
  removing.value = undefined
  busy.value = 'Excluindo montagem…'
  try {
    await deleteProject(id)
    await refresh()
    notify('Montagem excluída.')
  } catch (error) {
    notify(storageError(error), true)
  } finally {
    busy.value = ''
  }
}

async function duplicate(id) {
  if (busy.value) return
  busy.value = 'Duplicando montagem…'
  try {
    await duplicateProject(id)
    await refresh()
    notify('Cópia salva em Minhas montagens.')
  } catch (error) {
    notify(storageError(error), true)
  } finally {
    busy.value = ''
  }
}

async function rename(name) {
  await renameProject(renaming.value.id, name)
  await refresh()
}

function exit() {
  editor.value = undefined
  refresh()
}

async function install() {
  try {
    await installApp()
  } catch {
    help.value = true
  }
}

onMounted(() => {
  setupPwa()
  refresh()
})
</script>

<template>
  <EditorPage v-if="editor" :initial="editor" @exit="exit" @notice="notify" />
  <HomePage v-else :projects="summaries" :loading :offline="offlineStatus" :installable="canInstall"
    :inert="!!busy" @new="source = true" @open="reopen" @delete="removing = $event" @help="help = true" @install="install"
    @duplicate="duplicate" @rename="renaming = $event" @library="library = true" />
  <ImageSource v-model="source" title="Nova montagem" hint="Fotografe ou escolha a imagem que será o fundo da composição." @choose="start" />
  <CutoutLibrary v-if="!editor" v-model="library" />
  <NameDialog :model-value="Boolean(renaming)" :initial-name="renaming?.name" title="Renomear montagem"
    label="Nome da montagem" action="Salvar nome" :save="rename" @update:model-value="!$event && (renaming = undefined)" />

  <QDialog v-model="help">
    <QCard class="dialog-card">
      <div class="dialog-head"><h2>Como funciona</h2><QBtn round flat aria-label="Fechar" @click="help = false"><X :size="20" /></QBtn></div>
      <ol class="help-steps">
        <li>Comece uma montagem com uma foto de fundo.</li>
        <li>Adicione um objeto, desenhe ao redor dele e revise a transparência antes de aplicá-lo.</li>
        <li>Posicione os objetos, salve no dispositivo e exporte ou compartilhe a imagem.</li>
      </ol>
      <h3>Instalação e modo offline</h3>
      <p>Na versão PWA, abra o app no Chrome e aguarde a indicação “Offline pronto”. Use “Instalar aplicativo” ou o menu do Chrome para adicioná-lo à tela inicial.</p>
      <p class="muted">Fotos e projetos ficam neste navegador. Limpar os dados do site remove as montagens salvas.</p>
      <QBtn no-caps unelevated class="btn btn-primary" @click="help = false">Entendi</QBtn>
    </QCard>
  </QDialog>

  <QDialog :model-value="Boolean(removing)" @update:model-value="!$event && (removing = undefined)">
    <QCard class="dialog-card">
      <div class="dialog-head"><h2>Excluir montagem?</h2></div>
      <p>“{{ removing?.name }}” será removida deste dispositivo.</p>
      <div class="dialog-actions">
        <QBtn no-caps flat class="btn" @click="removing = undefined">Cancelar</QBtn>
        <QBtn no-caps unelevated class="btn btn-danger" @click="remove">Excluir montagem</QBtn>
      </div>
    </QCard>
  </QDialog>

  <div v-if="busy" class="busy-overlay" role="status"><QSpinner size="30px" />{{ busy }}</div>
  <aside v-if="notice" class="notice" :class="{ 'notice-error': notice.error }" :role="notice.error ? 'alert' : 'status'">
    <CircleAlert v-if="notice.error" :size="21" /><Check v-else :size="21" />
    <span>{{ notice.message }}</span>
    <QBtn flat round dense aria-label="Dispensar mensagem" @click="notice = undefined"><X :size="17" /></QBtn>
  </aside>
</template>
