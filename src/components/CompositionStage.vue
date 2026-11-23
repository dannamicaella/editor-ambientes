<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { QBtn, QSpinner } from 'quasar'
import { Hand, Maximize, Minus, MousePointer2, Plus } from '@lucide/vue'
import { constrainTransform, layerBox } from '../composables/projectModel.js'
import { useCanvasViewport } from '../composables/useCanvasViewport.js'
import { context2d } from '../services/images.js'
import { createPreviewCache, drawLayer, drawSelection, hitLayer, selectionGeometry } from '../services/composition.js'
import { angleDegrees, clamp, contain, pointerPair, pointerPosition } from '../utils/geometry.js'

const props = defineProps({
  project: { type: Object, required: true },
  assets: { type: Map, required: true },
  selected: String,
  shadowDraft: Object,
})
const emit = defineEmits(['select', 'transform', 'error'])
const stage = ref()
const navigation = ref(false)
const zoom = ref(1)
const loading = ref(true)
const draft = shallowRef()
const pointers = new Map()
let pan = { x: 0, y: 0 }
let gesture
const { size, refresh } = useCanvasViewport(stage, draw)
const cache = createPreviewCache(() => {
  loading.value = !cache.get(props.project.backgroundId)?.bitmap
  refresh()
}, () => {
  loading.value = false
  emit('error', 'Não foi possível mostrar uma das imagens da montagem.')
})
const background = computed(() => props.assets.get(props.project.backgroundId))

watch(() => props.project, (project, previous) => {
  const ids = new Set([project.backgroundId, ...project.layers.map((layer) => layer.assetId)])
  loading.value = !cache.get(project.backgroundId)?.bitmap
  cache.sync(new Map([...ids].map((id) => [id, props.assets.get(id)])), project.backgroundId)
  if (previous && project.backgroundId !== previous.backgroundId) resetView()
  refresh()
}, { immediate: true })
watch(() => props.selected, refresh)
watch(() => props.shadowDraft, refresh)
onBeforeUnmount(cache.dispose)

function getFrame() {
  const { width, height } = background.value
  const base = contain(width, height, Math.max(1, size.width - 48), Math.max(1, size.height - 56))
  const screenWidth = base.width * zoom.value
  const screenHeight = base.height * zoom.value
  return { x: (size.width - screenWidth) / 2 + pan.x, y: (size.height - screenHeight) / 2 + pan.y, width: screenWidth, height: screenHeight }
}

function currentLayer(id) {
  const layer = props.project.layers.find((candidate) => candidate.id === id)
  if (!layer) return undefined
  const transformed = draft.value?.id === id ? { ...layer, ...draft.value.patch } : layer
  return props.shadowDraft?.id === id ? { ...transformed, shadow: props.shadowDraft.value } : transformed
}

function draw(canvas) {
  const context = context2d(canvas)
  context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0)
  context.clearRect(0, 0, size.width, size.height)
  const bitmap = cache.get(props.project.backgroundId)?.bitmap
  if (!bitmap) return
  const frame = getFrame()
  context.imageSmoothingQuality = 'high'
  context.save()
  context.shadowColor = '#1f362535'
  context.shadowBlur = 25 * size.ratio
  context.shadowOffsetY = 6 * size.ratio
  context.fillStyle = '#ffffff'
  context.fillRect(frame.x, frame.y, frame.width, frame.height)
  context.restore()
  context.save()
  context.beginPath()
  context.rect(frame.x, frame.y, frame.width, frame.height)
  context.clip()
  context.drawImage(bitmap, frame.x, frame.y, frame.width, frame.height)
  for (const layer of props.project.layers) {
    const image = cache.get(layer.assetId)?.bitmap
    if (image) drawLayer(context, image, props.assets.get(layer.assetId), currentLayer(layer.id), frame, size.ratio)
  }
  context.restore()
  const selected = currentLayer(props.selected)
  if (selected && !navigation.value) drawSelection(context, selectionGeometry(selected, props.assets.get(selected.assetId), frame))
}

function setZoom(value, anchor = { x: size.width / 2, y: size.height / 2 }) {
  const next = clamp(value, 0.6, 5)
  const ratio = next / zoom.value
  pan = {
    x: anchor.x - size.width / 2 - (anchor.x - size.width / 2 - pan.x) * ratio,
    y: anchor.y - size.height / 2 - (anchor.y - size.height / 2 - pan.y) * ratio,
  }
  zoom.value = next
  refresh()
}

function resetView() {
  pan = { x: 0, y: 0 }
  zoom.value = 1
  refresh()
}

function setNavigation(value) {
  navigation.value = value
  refresh()
}

function startTransform(type, layer, point) {
  const frame = getFrame()
  const { centerX, centerY } = layerBox(layer, props.assets.get(layer.assetId), frame)
  gesture = { type, id: layer.id, layer, point, centerX, centerY, frame }
}

function down(event) {
  if (event.button !== 0 || pointers.size >= 2 || loading.value) return
  event.preventDefault()
  if (event.pointerType === 'mouse') stage.value.focus({ preventScroll: true })
  const point = pointerPosition(event, stage.value)
  stage.value.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, point)

  if (pointers.size === 2) {
    const pair = pointerPair(pointers)
    const layer = gesture?.id && currentLayer(gesture.id)
    if (layer && !navigation.value) startTransform('pinch-object', layer, pair)
    else gesture = { type: 'pinch-view', point: pair }
    return
  }
  if (navigation.value) {
    gesture = { type: 'pan', point }
    return
  }

  const frame = getFrame()
  const layer = currentLayer(props.selected)
  if (layer) {
    const handles = selectionGeometry(layer, props.assets.get(layer.assetId), frame)
    const radius = event.pointerType === 'mouse' ? 10 : 19
    const near = ({ x, y }) => Math.hypot(x - point.x, y - point.y) <= radius
    if (near(handles.rotate)) {
      startTransform('rotate', layer, point)
      return
    }
    if (handles.corners.some(near)) {
      startTransform('scale', layer, point)
      return
    }
  }
  const target = props.project.layers.slice().reverse().find((candidate) =>
    candidate.opacity > 0 && hitLayer(point, candidate, props.assets.get(candidate.assetId), frame, cache.get(candidate.assetId)?.hitMap))
  emit('select', target?.id)
  if (target) startTransform('move', target, point)
}

function transformObject(point) {
  const { id, type, layer, point: start, frame, centerX, centerY } = gesture
  const next = { ...layer }
  if (type === 'move' || type === 'pinch-object') {
    next.x += (point.x - start.x) / frame.width
    next.y += (point.y - start.y) / frame.height
  }
  if (type === 'pinch-object') {
    next.scale *= point.distance / start.distance
    next.rotation += point.angle - start.angle
  }
  if (type === 'scale' || type === 'rotate') {
    const a = { x: start.x - centerX, y: start.y - centerY }
    const b = { x: point.x - centerX, y: point.y - centerY }
    if (type === 'scale') next.scale *= Math.hypot(b.x, b.y) / Math.max(1, Math.hypot(a.x, a.y))
    else next.rotation += angleDegrees(b.x, b.y) - angleDegrees(a.x, a.y)
  }
  draft.value = { id, patch: constrainTransform(next) }
}

function move(event) {
  if (!pointers.has(event.pointerId)) return
  const point = pointerPosition(event, stage.value)
  pointers.set(event.pointerId, point)
  if (!gesture) return
  const { type } = gesture
  if (type === 'pinch-view' && pointers.size === 2) {
    const next = pointerPair(pointers)
    setZoom(zoom.value * next.distance / gesture.point.distance, gesture.point)
    pan.x += next.x - gesture.point.x
    pan.y += next.y - gesture.point.y
    gesture.point = next
  } else if (type === 'pan') {
    pan.x += point.x - gesture.point.x
    pan.y += point.y - gesture.point.y
    gesture.point = point
  } else if (gesture.id) {
    transformObject(type === 'pinch-object' ? pointerPair(pointers) : point)
  }
  refresh()
}

function end(event, canceled = false) {
  if (!pointers.has(event.pointerId)) return
  if (!canceled) move(event)
  pointers.delete(event.pointerId)
  if (canceled) {
    pointers.clear()
    gesture = draft.value = undefined
  } else if (pointers.size) {
    const point = pointerPair(pointers)
    if (gesture?.id) startTransform('move', currentLayer(gesture.id), point)
    else gesture = { type: 'pan', point }
  } else {
    if (draft.value) emit('transform', draft.value.id, draft.value.patch)
    gesture = draft.value = undefined
  }
  refresh()
}

function keyboard(event) {
  const layer = currentLayer(props.selected)
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
  if (!layer || !direction) return
  event.preventDefault()
  const step = event.shiftKey ? 0.035 : 0.005
  emit('transform', layer.id, constrainTransform({ ...layer, x: layer.x + direction[0] * step, y: layer.y + direction[1] * step }))
}
</script>

<template>
  <div class="workspace-stage">
    <div class="stage-heading"><strong>Área de montagem</strong><span>{{ background.width }} × {{ background.height }} px</span></div>
    <div class="composition-surface">
      <canvas ref="stage" class="interactive-canvas" :class="{ 'pan-cursor': navigation }" tabindex="0"
        aria-label="Área da montagem. Use as setas para mover o objeto selecionado."
        @pointerdown="down" @pointermove="move" @pointerup="end" @pointercancel="end($event, true)"
        @lostpointercapture="end($event, true)" @keydown="keyboard"
        @wheel.prevent="setZoom(zoom * (1 + Math.sign(-$event.deltaY) * 0.15), pointerPosition($event, stage))">
      </canvas>
      <div v-if="loading" class="canvas-busy" role="status"><QSpinner size="24px" /> Preparando prévia…</div>
    </div>
    <div class="stage-controls">
      <div class="tool-group">
        <QBtn flat no-caps class="btn" :class="{active: !navigation}" :aria-pressed="!navigation" @click="setNavigation(false)"><MousePointer2 :size="17" /> Selecionar</QBtn>
        <QBtn flat no-caps class="btn" :class="{active: navigation}" :aria-pressed="navigation" @click="setNavigation(true)"><Hand :size="17" /> Navegar</QBtn>
      </div>
      <div class="tool-group">
        <QBtn flat round aria-label="Diminuir zoom" @click="setZoom(zoom / 1.2)"><Minus :size="17" /></QBtn>
        <output aria-label="Zoom da montagem">{{ Math.round(zoom * 100) }}%</output>
        <QBtn flat round aria-label="Aumentar zoom" @click="setZoom(zoom * 1.2)"><Plus :size="17" /></QBtn>
        <QBtn flat round aria-label="Ajustar montagem à tela" @click="resetView"><Maximize :size="17" /></QBtn>
      </div>
    </div>
  </div>
</template>
