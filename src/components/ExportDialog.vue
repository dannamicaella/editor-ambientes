<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { QBtn, QCard, QDialog, QSpinner } from 'quasar'
import { Download, Share2, X } from '@lucide/vue'
import { downloadImage, exportChoices, fileName, renderExport } from '../services/export.js'

const props = defineProps({ modelValue: Boolean, project: Object, assets: Map, shareFirst: Boolean })
const emit = defineEmits(['update:modelValue', 'notice'])
const type = ref('image/png')
const quality = ref(92)
const choice = ref('large')
const busy = ref(false)
const issue = ref('')
const file = shallowRef()
const background = computed(() => props.assets.get(props.project.backgroundId))
const options = computed(() => exportChoices(background.value))
const selected = computed(() => options.value.find(({ id }) => id === choice.value) || options.value[0])
const reduced = computed(() => selected.value.width !== background.value.width || selected.value.height !== background.value.height)
const shareAvailable = computed(() => !!file.value && typeof navigator.canShare === 'function'
  && typeof navigator.share === 'function' && navigator.canShare({ files: [file.value] }))

watch(() => props.modelValue, (value) => {
  if (value) resetFile()
})
watch([type, quality, choice], resetFile)

function resetFile() {
  file.value = undefined
  issue.value = ''
}

async function prepare() {
  if (busy.value) return
  resetFile()
  busy.value = true
  try {
    const mime = type.value
    const blob = await renderExport(props.project, props.assets, selected.value, mime, quality.value / 100)
    file.value = new File([blob], fileName(props.project.name, mime), { type: blob.type })
    if (!props.shareFirst) download()
  } catch {
    issue.value = options.value.length > 1 && choice.value !== 'compact'
      ? 'Não foi possível exportar nesta resolução. Tente a opção Compacta.'
      : 'Não foi possível gerar o arquivo. Tente fechar outras abas e exportar novamente.'
  } finally {
    busy.value = false
  }
}

function download() {
  downloadImage(file.value)
  emit('notice', 'Download da montagem iniciado.')
}

async function share() {
  if (!shareAvailable.value) return
  try {
    await navigator.share({ files: [file.value] })
    emit('notice', 'Imagem enviada ao compartilhamento do dispositivo.')
  } catch (error) {
    if (error.name !== 'AbortError') issue.value = 'O menu de compartilhamento falhou. Baixe o arquivo para compartilhá-lo.'
  }
}
</script>

<template>
  <QDialog :model-value="modelValue" :persistent="busy" @update:model-value="emit('update:modelValue', $event)">
    <QCard class="dialog-card">
      <div class="dialog-head"><h2>{{ shareFirst ? 'Compartilhar montagem' : 'Exportar montagem' }}</h2><QBtn flat round aria-label="Fechar" :disable="busy" @click="emit('update:modelValue', false)"><X :size="20" /></QBtn></div>
      <p class="muted">Gere uma imagem da composição na resolução escolhida.</p>
      <div class="export-fields">
        <label>Formato<select v-model="type" :disabled="busy"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label>
        <label>Resolução<select v-model="choice" :disabled="busy"><option v-for="option in options" :key="option.id" :value="option.id">{{ option.label }} · {{ option.width }} × {{ option.height }}</option></select></label>
        <label v-if="type === 'image/jpeg'" class="layer-range"><span>Qualidade JPEG <span>{{ quality }}%</span></span><input v-model.number="quality" aria-label="Qualidade JPEG" type="range" min="40" max="100" :disabled="busy"></label>
      </div>
      <p v-if="reduced" class="inline-warning">A imagem terá menos pixels que a foto de fundo para reduzir o consumo de memória.</p>
      <p v-if="issue" class="inline-warning" role="alert">{{ issue }}</p>
      <p v-else-if="file && shareFirst" class="export-ready" role="status">{{ shareAvailable ? 'Imagem pronta. Escolha o WhatsApp ou outro aplicativo no menu do dispositivo.' : 'O compartilhamento de arquivos está indisponível neste navegador. Baixe a imagem para compartilhá-la.' }}</p>
      <div v-if="busy" class="status-inline" role="status"><QSpinner size="22px" /> Gerando imagem…</div>
      <div class="dialog-actions">
        <template v-if="file">
          <QBtn no-caps unelevated class="btn" :class="shareAvailable ? 'btn-outline' : 'btn-primary'" @click="download"><Download :size="17" /> Baixar imagem</QBtn>
          <QBtn v-if="shareAvailable" no-caps unelevated class="btn btn-primary" @click="share"><Share2 :size="17" /> Compartilhar arquivo</QBtn>
        </template>
        <QBtn v-else no-caps unelevated class="btn btn-primary" :disable="busy" @click="prepare"><Download :size="17" /> {{ shareFirst ? 'Preparar imagem' : 'Exportar e baixar' }}</QBtn>
      </div>
    </QCard>
  </QDialog>
</template>
