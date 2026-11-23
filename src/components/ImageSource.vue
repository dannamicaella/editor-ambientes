<script setup>
import { ref } from 'vue'
import { QBtn, QCard, QDialog } from 'quasar'
import { Camera, Image, Scissors, X } from '@lucide/vue'
import { IMAGE_TYPES } from '../services/images.js'
import { cameraInputAttributes } from '../services/camera.js'

defineProps({ modelValue: Boolean, title: String, hint: String, allowLibrary: Boolean })
const emit = defineEmits(['update:modelValue', 'choose', 'library'])
const gallery = ref()
const camera = ref()
let pendingFile
let pendingLibrary = false

function pick(event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (file) {
    pendingFile = file
    emit('update:modelValue', false)
  }
}

function afterHide() {
  if (pendingLibrary) {
    pendingLibrary = false
    emit('library')
  }
  if (!pendingFile) return
  const file = pendingFile
  pendingFile = undefined
  emit('choose', file)
}
</script>

<template>
  <QDialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" @hide="afterHide">
    <QCard class="dialog-card" role="document">
      <div class="dialog-head">
        <h2>{{ title }}</h2>
        <QBtn flat round aria-label="Fechar" @click="emit('update:modelValue', false)"><X :size="20" /></QBtn>
      </div>
      <p class="muted">{{ hint }}</p>
      <input ref="camera" hidden type="file" v-bind="cameraInputAttributes()" @change="pick">
      <input ref="gallery" hidden type="file" :accept="IMAGE_TYPES" @change="pick">
      <div class="source-options">
        <QBtn no-caps unelevated class="source-choice" @click="camera.click()"><Camera :size="22" /> Fotografar</QBtn>
        <QBtn no-caps unelevated class="source-choice" @click="gallery.click()"><Image :size="22" /> Escolher da galeria</QBtn>
      </div>
      <QBtn v-if="allowLibrary" no-caps unelevated class="btn btn-outline source-library"
        @click="pendingLibrary = true; emit('update:modelValue', false)"><Scissors :size="18" /> Meus Recortes</QBtn>
    </QCard>
  </QDialog>
</template>
