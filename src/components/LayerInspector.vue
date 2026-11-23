<script setup>
import { computed } from 'vue'
import { QBtn } from 'quasar'
import { ArrowDown, ArrowUp, Copy, Image, Layers3, Plus, Scissors, Trash2 } from '@lucide/vue'
import ShadowControls from './ShadowControls.vue'

const props = defineProps({ layers: Array, selected: String, open: Boolean, shadowDraft: Object })
const emit = defineEmits(['select', 'add', 'duplicate', 'delete', 'reorder', 'change', 'mask', 'toggle', 'replace', 'shadow-preview'])
const index = computed(() => props.layers.findIndex((layer) => layer.id === props.selected))
const target = computed(() => props.layers[index.value])
function change(property, value) {
  if (target.value) emit('change', target.value.id, property, value)
}
</script>

<template>
  <aside class="inspector" :class="{ 'inspector-open': open }" aria-label="Camadas e ajustes">
    <div class="inspector-title">
      <div><Layers3 :size="20" /><h2>Camadas</h2><span>{{ layers.length }}</span></div>
      <QBtn no-caps flat class="btn mobile-inspector-toggle" :aria-expanded="open" aria-controls="inspector-body" @click="emit('toggle')">{{ open ? 'Recolher' : 'Mostrar' }}</QBtn>
    </div>
    <div id="inspector-body" class="inspector-body">
      <QBtn no-caps flat class="btn replace-background" @click="emit('replace')"><Image :size="17" /> Trocar foto de fundo</QBtn>
      <ul v-if="layers.length" class="layer-list">
        <li v-for="layer in layers.slice().reverse()" :key="layer.id">
          <button type="button" class="layer-row" :aria-pressed="layer.id === selected" @click="emit('select', layer.id)">
            <span><Layers3 :size="17" /></span><strong>{{ layer.name }}</strong>
          </button>
        </li>
      </ul>
      <div v-else class="empty-layers">
        <p>Adicione uma foto de objeto para recortar e posicionar aqui.</p>
        <QBtn no-caps flat class="btn btn-text" @click="emit('add')"><Plus :size="17" /> Adicionar objeto</QBtn>
      </div>

      <div v-if="target" class="layer-properties">
        <div class="layer-actions" aria-label="Ações da camada selecionada">
          <QBtn flat round aria-label="Subir camada" title="Subir camada" :disable="index >= layers.length - 1" @click="emit('reorder', target.id, 1)"><ArrowUp :size="19" /></QBtn>
          <QBtn flat round aria-label="Descer camada" title="Descer camada" :disable="index <= 0" @click="emit('reorder', target.id, -1)"><ArrowDown :size="19" /></QBtn>
          <QBtn flat round aria-label="Duplicar objeto" title="Duplicar objeto" @click="emit('duplicate', target.id)"><Copy :size="18" /></QBtn>
          <QBtn flat round aria-label="Excluir objeto" title="Excluir objeto" class="danger-text" @click="emit('delete', target.id)"><Trash2 :size="18" /></QBtn>
        </div>
        <h3>Ajustes do objeto</h3>
        <div class="position-fields">
          <label>Posição X <input type="number" min="-25" max="125" step="0.5" :value="Math.round(target.x * 1000) / 10" @change="change('x', $event.target.valueAsNumber / 100)"></label>
          <label>Posição Y <input type="number" min="-25" max="125" step="0.5" :value="Math.round(target.y * 1000) / 10" @change="change('y', $event.target.valueAsNumber / 100)"></label>
        </div>
        <label class="layer-range"><span>Escala <span>{{ Math.round(target.scale * 100) }}%</span></span><input aria-label="Escala" type="range" min="2.5" max="300" step="0.5" :value="target.scale * 100" @change="change('scale', $event.target.valueAsNumber / 100)"></label>
        <label class="layer-range"><span>Rotação <span>{{ Math.round(target.rotation) }}°</span></span><input aria-label="Rotação" type="range" min="-180" max="180" step="1" :value="target.rotation" @change="change('rotation', $event.target.valueAsNumber)"></label>
        <label class="layer-range"><span>Opacidade <span>{{ Math.round(target.opacity * 100) }}%</span></span><input aria-label="Opacidade" type="range" min="0" max="100" step="1" :value="target.opacity * 100" @change="change('opacity', $event.target.valueAsNumber / 100)"></label>
        <ShadowControls :key="target.id" :model-value="target.shadow"
          :preview="shadowDraft?.id === target.id ? shadowDraft.value : undefined"
          @preview="emit('shadow-preview', target.id, $event)" @update:model-value="change('shadow', $event)" />
        <QBtn no-caps unelevated class="btn btn-outline mask-button" @click="emit('mask', target.id)"><Scissors :size="17" /> Editar recorte</QBtn>
      </div>
    </div>
  </aside>
</template>
