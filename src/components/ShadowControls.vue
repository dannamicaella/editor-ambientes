<script setup>
import { computed } from 'vue'
import { QBtn } from 'quasar'
import { AUTO_SHADOW, shadowSettings } from '../composables/shadowModel.js'

const props = defineProps({ modelValue: [Boolean, Object], preview: Object })
const emit = defineEmits(['update:modelValue', 'preview'])
const settings = computed(() => props.preview ?? shadowSettings(props.modelValue))
const sliders = [
  { key: 'opacity', label: 'Opacidade da sombra ambiente', min: 0, max: 100 },
  { key: 'blur', label: 'Desfoque da sombra ambiente', min: 0, max: 18 },
  { key: 'x', label: 'Deslocamento horizontal da sombra', min: -25, max: 25 },
  { key: 'y', label: 'Deslocamento vertical da sombra', min: -25, max: 25 },
  { key: 'contact', label: 'Intensidade da sombra de contato', min: 0, max: 100 },
]

function update(key, value, event = 'update:modelValue') {
  emit(event, shadowSettings({ ...settings.value, [key]: value }))
}

function toggle(enabled) {
  const value = props.modelValue === false && enabled ? AUTO_SHADOW : settings.value
  emit('update:modelValue', { ...value, enabled })
}
</script>

<template>
  <section class="shadow-controls" aria-label="Sombras da camada">
    <label class="check-inline">
      <input type="checkbox" :checked="settings.enabled" @change="toggle($event.target.checked)">
      Aplicar sombra
    </label>
    <details v-if="settings.enabled" class="shadow-settings">
      <summary>Ajustar sombras</summary>
      <QBtn class="btn btn-outline shadow-auto" no-caps unelevated @click="emit('update:modelValue', { ...AUTO_SHADOW })">Sombra automática</QBtn>
      <label v-for="slider in sliders" :key="slider.key" class="layer-range">
        <span>{{ slider.label }} <output>{{ settings[slider.key] }}%</output></span>
        <input type="range" :aria-label="slider.label" :min="slider.min" :max="slider.max" :value="settings[slider.key]"
          @input="update(slider.key, $event.target.valueAsNumber, 'preview')"
          @pointercancel="emit('preview', null)"
          @change="update(slider.key, $event.target.valueAsNumber)">
      </label>
      <label class="shadow-color">Cor da sombra
        <input type="color" :value="settings.color" @input="update('color', $event.target.value, 'preview')"
          @change="update('color', $event.target.value)">
      </label>
      <p>Deslocamentos em relação ao maior lado do objeto. A sombra de contato acompanha sua base.</p>
    </details>
  </section>
</template>
