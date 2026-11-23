<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { QBtn } from 'quasar'
import { Copy, Image, Pencil, Trash2 } from '@lucide/vue'

const props = defineProps({ project: { type: Object, required: true } })
defineEmits(['open', 'delete', 'duplicate', 'rename'])
const url = ref('')
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

watch(() => props.project.thumbnail, (thumbnail) => {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = thumbnail ? URL.createObjectURL(thumbnail) : ''
}, { immediate: true })
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })
</script>

<template>
  <article class="project-tile">
    <button class="tile-open" type="button" :aria-label="'Abrir montagem ' + project.name" @click="$emit('open')">
      <div class="tile-image">
        <img v-if="url" :src="url" alt="">
        <Image v-else :size="28" aria-hidden="true" />
      </div>
      <span class="tile-info">
        <strong>{{ project.name }}</strong>
        <span>{{ date.format(project.updatedAt) }} · {{ project.count }} {{ project.count === 1 ? 'objeto' : 'objetos' }}</span>
      </span>
    </button>
    <div class="project-actions">
      <QBtn flat no-caps class="btn btn-text" :aria-label="'Duplicar ' + project.name" @click="$emit('duplicate')"><Copy :size="17" /> Duplicar</QBtn>
      <QBtn flat round :aria-label="'Renomear ' + project.name" title="Renomear" @click="$emit('rename')"><Pencil :size="17" /></QBtn>
      <QBtn flat round :aria-label="'Excluir ' + project.name" title="Excluir" @click="$emit('delete')"><Trash2 :size="17" /></QBtn>
    </div>
  </article>
</template>
