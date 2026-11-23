<script setup>
import { onMounted, ref, shallowRef } from 'vue'
import { QBtn, QCard, QDialog, QSpinner } from 'quasar'
import { Download, Upload, X } from '@lucide/vue'
import { backupCounts, backupFileName, encodeBackup, inspectBackup, storageEstimate, verifyBackup } from '../services/backup.js'
import { downloadImage } from '../services/export.js'
import { readBackupSnapshot, restoreBackupSnapshot, storageError } from '../services/projects.js'

defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'restored'])
const picker = ref()
const busy = ref('')
const percent = ref()
const error = ref('')
const message = ref('')
const prepared = shallowRef()
const counts = ref()
const estimate = shallowRef()
const estimateReady = ref(false)
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

function bytes(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unit = value ? Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0
  return number.format(value / 1024 ** unit) + ' ' + units[unit]
}

async function refreshEstimate() {
  estimate.value = await storageEstimate()
  estimateReady.value = true
}

function progress(done, total) {
  percent.value = Math.min(100, Math.floor(100 * done / total))
}

function clearSelection() {
  prepared.value = undefined
  counts.value = undefined
}

async function exportData() {
  if (busy.value) return
  clearSelection()
  busy.value = 'Preparando backup…'
  error.value = message.value = ''
  try {
    const blob = await encodeBackup(await readBackupSnapshot(), progress)
    downloadImage(new File([blob], backupFileName(), { type: blob.type }))
    message.value = 'Backup gerado. Guarde o arquivo em um local seguro.'
  } catch (problem) {
    error.value = storageError(problem)
  } finally {
    busy.value = ''
    percent.value = undefined
  }
}

async function select(event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file || busy.value) return
  clearSelection()
  busy.value = 'Conferindo o arquivo…'
  error.value = message.value = ''
  try {
    const next = await inspectBackup(file)
    await refreshEstimate()
    counts.value = backupCounts(next)
    prepared.value = next
  } catch (problem) {
    error.value = storageError(problem)
  } finally {
    busy.value = ''
  }
}

async function restore() {
  if (busy.value || !prepared.value) return
  const next = prepared.value
  const hadSpaceWarning = estimate.value && next.file.size > estimate.value.available
  busy.value = 'Validando as imagens…'
  error.value = ''
  try {
    await refreshEstimate()
    if (!hadSpaceWarning && estimate.value && next.file.size > estimate.value.available) return
    const snapshot = await verifyBackup(next, progress)
    busy.value = 'Comparando com os dados locais…'
    percent.value = undefined
    const result = await restoreBackupSnapshot(snapshot)
    clearSelection()
    message.value = `Montagens adicionadas: ${result.projects}. Montagens ignoradas: ${result.ignoredProjects}. Recortes adicionados: ${result.cutouts}. Recortes ignorados: ${result.ignoredCutouts}. Conflitos de ID resolvidos: ${result.conflicts}.`
    if (result.projects || result.cutouts) emit('restored')
    await refreshEstimate()
  } catch (problem) {
    if (problem?.name === 'QuotaExceededError') {
      error.value = 'Falta espaço para restaurar o backup. A importação foi desfeita. Libere espaço e tente novamente.'
      await refreshEstimate()
    } else {
      error.value = storageError(problem)
      clearSelection()
    }
  } finally {
    busy.value = ''
    percent.value = undefined
  }
}

onMounted(refreshEstimate)
</script>

<template>
  <QDialog :model-value="modelValue" :persistent="!!busy" @update:model-value="emit('update:modelValue', $event)">
    <QCard class="dialog-card backup-dialog">
      <div class="dialog-head">
        <h2>Backup e Restauração</h2>
        <QBtn flat round aria-label="Fechar" :disable="!!busy" @click="emit('update:modelValue', false)"><X :size="20" /></QBtn>
      </div>

      <p>As montagens salvas e os recortes ficam neste navegador. Guarde o arquivo exportado em um local seguro. Ele contém suas fotos e pode ser aberto por quem tiver acesso a ele.</p>
      <section class="backup-storage" aria-label="Estimativa de armazenamento local">
        <h3>Armazenamento local</h3>
        <p v-if="estimate"><strong>{{ bytes(estimate.used) }}</strong> em uso de uma cota estimada de {{ bytes(estimate.quota) }}.</p>
        <p v-else>{{ estimateReady ? 'Estimativa indisponível neste navegador.' : 'Consultando estimativa…' }}</p>
        <p v-if="estimate" class="muted">O navegador pode incluir outros dados deste site, como o cache offline e os arquivos da IA.</p>
      </section>

      <div class="backup-actions">
        <QBtn no-caps unelevated class="btn btn-primary" :disable="!!busy" @click="exportData"><Download :size="18" /> Exportar backup</QBtn>
        <QBtn no-caps unelevated class="btn btn-outline" :disable="!!busy" @click="picker.click()"><Upload :size="18" /> Importar backup</QBtn>
        <input ref="picker" type="file" hidden @change="select">
      </div>

      <section v-if="prepared" class="backup-confirm" aria-label="Confirmar restauração">
        <h3>Restaurar backup?</h3>
        <p>Montagens no arquivo: {{ counts.projects }}. Recortes no arquivo: {{ counts.cutouts }}. Os itens idênticos que já existem neste navegador serão ignorados.</p>
        <p v-if="estimate && prepared.file.size > estimate.available" class="inline-warning">
          O arquivo tem {{ bytes(prepared.file.size) }} e o espaço disponível estimado é {{ bytes(estimate.available) }}. A restauração pode falhar por falta de espaço.
        </p>
        <div class="dialog-actions">
          <QBtn flat no-caps class="btn" :disable="!!busy" @click="clearSelection">Cancelar</QBtn>
          <QBtn unelevated no-caps class="btn btn-primary" :disable="!!busy" @click="restore">Confirmar restauração</QBtn>
        </div>
      </section>

      <div v-if="busy" class="backup-progress" role="status">
        <span><QSpinner size="20px" /> {{ busy }}</span>
        <progress v-if="percent !== undefined" :value="percent" max="100" aria-label="Progresso do backup"></progress>
      </div>
      <p v-if="error" class="danger-text" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
    </QCard>
  </QDialog>
</template>
