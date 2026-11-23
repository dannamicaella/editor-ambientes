<script setup>
import { ref, watch } from 'vue'
import { QBtn, QCard, QDialog } from 'quasar'
import { X } from '@lucide/vue'
import { PROJECT_NAME_LIMIT, storageError } from '../services/projects.js'

const props = defineProps({
  modelValue: Boolean, initialName: String, title: String, label: String, action: String, save: Function,
})
const emit = defineEmits(['update:modelValue'])
const name = ref('')
const error = ref('')
const busy = ref(false)

watch(() => props.modelValue, (open) => {
  if (!open) return
  name.value = props.initialName?.slice(0, PROJECT_NAME_LIMIT) ?? ''
  error.value = ''
}, { immediate: true })

async function submit() {
  if (busy.value || !name.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    await props.save(name.value.trim())
    emit('update:modelValue', false)
  } catch (problem) {
    error.value = storageError(problem)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <QDialog :model-value="modelValue" :persistent="busy" @update:model-value="emit('update:modelValue', $event)">
    <QCard class="dialog-card">
      <div class="dialog-head">
        <h2>{{ title }}</h2>
        <QBtn flat round aria-label="Fechar" :disable="busy" @click="emit('update:modelValue', false)"><X :size="20" /></QBtn>
      </div>
      <form class="name-form" @submit.prevent="submit">
        <label>{{ label }}<input v-model="name" :maxlength="PROJECT_NAME_LIMIT" data-autofocus required :disabled="busy"></label>
        <p v-if="error" class="danger-text" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <QBtn flat no-caps class="btn" :disable="busy" @click="emit('update:modelValue', false)">Cancelar</QBtn>
          <QBtn unelevated no-caps class="btn btn-primary" type="submit" :loading="busy" :disable="!name.trim()">{{ action }}</QBtn>
        </div>
      </form>
    </QCard>
  </QDialog>
</template>
