<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { QBtn, QSpinner } from 'quasar'
import { Check, Eraser, Hand, Lasso, Minus, Paintbrush, Plus, Redo2, RotateCcw, Scissors, Sparkles, Undo2, X, ZoomIn } from '@lucide/vue'
import { useCanvasViewport } from '../composables/useCanvasViewport.js'
import { useMaskHistory } from '../composables/useMaskHistory.js'
import { context2d, createCanvas, decodeImage, releaseImage } from '../services/images.js'
import { contourMask, contourPath, contourRegion, drawMasked, finishMask, polygonMask, savedMask } from '../services/masks.js'
import { createMobileSam, verifyAiCache } from '../services/mobileSam.js'
import { maskPolygons, updatePrompt } from '../services/mobileSamGeometry.js'
import { clamp, contain, pointerPair, pointerPosition } from '../utils/geometry.js'

const props = defineProps({ input: { type: Object, required: true } })
const emit = defineEmits(['cancel', 'confirm'])
const stage = ref()
const phase = ref('contour')
const tool = ref('positive')
const manual = ref(false)
const manualAvailable = ref(false)
const zoom = ref(1)
const { image, asset } = props.input
const frame = { width: asset.originalWidth ?? asset.width, height: asset.originalHeight ?? asset.height }
const brush = ref(Math.max(32, Math.round(Math.min(frame.width, frame.height) * 0.025)))
const brushMax = Math.max(200, Math.round(Math.min(frame.width, frame.height) * 0.12))
const points = ref([])
const prompts = ref([])
const busy = ref('')
const message = ref('')
const feedback = ref('')
const promptUndo = shallowRef([])
const variant = ref('contour')
const inference = shallowRef()
const diagnosticText = ref('')
const aiCached = ref(false)
const percent = ref(null)
const showOriginal = ref(false)
const solid = ref(false)
const method = computed(() => ({
  contour: 'Recorte manual', ai: 'Recorte por IA', saved: 'Máscara salva',
})[variant.value])
const history = useMaskHistory(frame)
const { canUndo, canRedo } = history
let maskedPreview
let checker
let restoredBitmap
let lastView
let previewDirty = true
let pan = { x: 0, y: 0 }
let gesture
let cursor
let segmenter
let running = false
let requested
let accepted
const maskSnapshots = new Map()
const pointers = new Map()
const { size, refresh } = useCanvasViewport(stage, draw)
const validContour = computed(() => points.value.length >= 3)
const validSelection = computed(() => validContour.value || prompts.value.some(({ type }) => type === 'positive'))
const canPrompt = computed(() => !manual.value && (phase.value === 'contour' || variant.value === 'ai'))
const canUndoPrompt = computed(() => promptUndo.value.length > 0 &&
  (phase.value !== 'mask' || validContour.value || promptUndo.value.at(-1).some(({ type }) => type === 'positive')))
let disposed = false

if (asset.mask) restorePrevious()

async function restorePrevious() {
  busy.value = 'Abrindo máscara…'
  let bitmap
  try {
    bitmap = await decodeImage(asset.mask)
    if (disposed) return
    const region = asset.maskRegion ?? { x: 0, y: 0, width: frame.width, height: frame.height }
    history.setBase(() => savedMask(bitmap, region), true)
    restoredBitmap = bitmap
    variant.value = 'saved'
    enterReview()
  } catch {
    if (!disposed) message.value = 'Não foi possível abrir a máscara salva. Você pode refazer o recorte.'
  } finally {
    if (bitmap !== restoredBitmap) releaseImage(bitmap)
    busy.value = ''
  }
}
onBeforeUnmount(() => {
  disposed = true
  segmenter?.dispose()
  history.dispose()
  releaseImage(maskedPreview)
  releaseImage(checker)
  releaseImage(restoredBitmap)
})

function getBox() {
  const base = contain(frame.width, frame.height, Math.max(1, size.width - 32), Math.max(1, size.height - 32))
  const width = base.width * zoom.value
  const height = base.height * zoom.value
  return { x: (size.width - width) / 2 + pan.x, y: (size.height - height) / 2 + pan.y, width, height }
}

function toImage(point) {
  const box = getBox()
  return {
    x: clamp((point.x - box.x) * frame.width / box.width, 0, frame.width),
    y: clamp((point.y - box.y) * frame.height / box.height, 0, frame.height),
  }
}

function draw(canvas) {
  const context = context2d(canvas)
  context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0)
  context.clearRect(0, 0, size.width, size.height)
  const box = getBox()
  context.save()
  context.translate(box.x, box.y)
  if (phase.value === 'mask' && history.mask && !showOriginal.value) {
    if (!checker) {
      checker = createCanvas(24, 24)
      const tiles = context2d(checker)
      tiles.fillStyle = '#ffffff'
      tiles.fillRect(0, 0, 24, 24)
      tiles.fillStyle = '#dce1da'
      tiles.fillRect(0, 0, 12, 12)
      tiles.fillRect(12, 12, 12, 12)
    }
    context.fillStyle = solid.value ? '#263745' : context.createPattern(checker, 'repeat')
    context.fillRect(0, 0, box.width, box.height)
    if (!maskedPreview || maskedPreview.width !== canvas.width || maskedPreview.height !== canvas.height) {
      releaseImage(maskedPreview)
      maskedPreview = createCanvas(canvas.width, canvas.height)
      previewDirty = true
    }
    const view = [box.x, box.y, box.width, box.height, size.ratio]
    if (previewDirty || view.some((value, index) => value !== lastView?.[index])) {
      const [x, y, width, height] = view.map((value) => value * size.ratio)
      drawMasked(context2d(maskedPreview), image, history.mask, frame, { x, y, width, height })
      previewDirty = false
      lastView = view
    }
    context.drawImage(maskedPreview, -box.x, -box.y, canvas.width / size.ratio, canvas.height / size.ratio)
  } else {
    context.drawImage(image, 0, 0, box.width, box.height)
    if (points.value.length && phase.value === 'contour') {
      contourPath(context, points.value.map((p) => ({
        x: p.x * box.width / frame.width, y: p.y * box.height / frame.height,
      })))
      if (gesture?.type !== 'lasso') context.closePath()
      context.lineWidth = 4
      context.strokeStyle = '#172f26'
      context.stroke()
      context.lineWidth = 2
      context.strokeStyle = '#e6f6ab'
      context.setLineDash([6, 4])
      context.stroke()
    }
  }
  if (canPrompt.value && tool.value !== 'erase' && tool.value !== 'restore') {
    for (const { x, y, type } of prompts.value) {
      drawPrompt(context, x * box.width, y * box.height, type === 'positive')
    }
  }
  context.restore()
  if (cursor && phase.value === 'mask' && ['erase', 'restore'].includes(tool.value)) {
    const radius = brush.value * box.width / frame.width / 2
    context.beginPath()
    context.arc(cursor.x, cursor.y, Math.max(2, radius), 0, Math.PI * 2)
    context.lineWidth = 3
    context.strokeStyle = '#152b20'
    context.stroke()
    context.lineWidth = 1
    context.strokeStyle = 'white'
    context.stroke()
  }
}

function drawPrompt(context, x, y, positive) {
  context.save()
  context.fillStyle = positive ? '#1f7049' : '#a23e2f'
  context.strokeStyle = 'white'
  context.lineWidth = 2
  context.beginPath()
  context.arc(x, y, 9, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.beginPath()
  context.moveTo(x - 4, y)
  context.lineTo(x + 4, y)
  if (positive) {
    context.moveTo(x, y - 4)
    context.lineTo(x, y + 4)
  }
  context.stroke()
  context.restore()
}

function markMask() {
  previewDirty = true
  refresh()
}

watch([phase, points, prompts, zoom, tool, brush, solid, showOriginal], refresh)
watch(history.canUndo, markMask)
watch(history.canRedo, markMask)

function adjustZoom(value, anchor = { x: size.width / 2, y: size.height / 2 }) {
  const next = clamp(Number(value), 1, 6)
  const ratio = next / zoom.value
  pan = {
    x: anchor.x - size.width / 2 - (anchor.x - size.width / 2 - pan.x) * ratio,
    y: anchor.y - size.height / 2 - (anchor.y - size.height / 2 - pan.y) * ratio,
  }
  zoom.value = next
  refresh()
}

function down(event) {
  const queuedPrompt = running && phase.value === 'mask' && canPrompt.value && ['positive', 'negative'].includes(tool.value)
  if ((busy.value && !queuedPrompt) || event.button !== 0 || pointers.size >= 2) return
  event.preventDefault()
  const point = pointerPosition(event, stage.value)
  stage.value.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, point)
  if (pointers.size === 2) {
    if (gesture?.type === 'lasso') points.value = gesture.previous
    if (gesture?.type === 'brush') {
      history.cancel()
      markMask()
    }
    gesture = { type: 'pinch', start: pointerPair(pointers) }
    cursor = undefined
  } else if (tool.value === 'pan') {
    gesture = { type: 'pan', start: point }
  } else {
    const inside = getBox()
    if (point.x < inside.x || point.y < inside.y || point.x > inside.x + inside.width || point.y > inside.y + inside.height) return
    const selected = toImage(point)
    if (canPrompt.value && ['positive', 'negative'].includes(tool.value)) {
      gesture = { type: 'prompt', start: point, label: tool.value }
    } else if (phase.value === 'contour') {
      gesture = { type: 'lasso', previous: points.value }
      points.value = [selected]
      message.value = ''
    } else {
      gesture = { type: 'brush' }
      cursor = point
      history.begin(tool.value, brush.value, selected)
      markMask()
    }
  }
  refresh()
}

function move(event) {
  const point = pointerPosition(event, stage.value)
  if (event.pointerType === 'mouse' && !busy.value && !gesture) {
    cursor = point
    refresh()
  }
  if (!pointers.has(event.pointerId) || !gesture) return
  pointers.set(event.pointerId, point)
  if (gesture.type === 'pinch') {
    if (pointers.size === 2) {
      const next = pointerPair(pointers)
      adjustZoom(zoom.value * next.distance / gesture.start.distance, gesture.start)
      pan.x += next.x - gesture.start.x
      pan.y += next.y - gesture.start.y
      gesture.start = next
    }
  } else if (gesture.type === 'pan') {
    pan.x += point.x - gesture.start.x
    pan.y += point.y - gesture.start.y
    gesture.start = point
  } else if (gesture.type === 'lasso') {
    const threshold = Math.max(0.25, 0.65 * frame.width / getBox().width)
    for (const sample of [...(event.getCoalescedEvents?.() ?? []), event]) {
      const selected = toImage(pointerPosition(sample, stage.value))
      const last = points.value.at(-1)
      if (Math.hypot(selected.x - last.x, selected.y - last.y) >= threshold) points.value.push(selected)
    }
  } else if (gesture.type === 'brush') {
    cursor = point
    history.append(toImage(point))
    markMask()
  }
  refresh()
}

function end(event, canceled = false) {
  if (!pointers.has(event.pointerId)) return
  if (!canceled && gesture?.type !== 'pinch') move(event)
  pointers.delete(event.pointerId)
  if (pointers.size) return
  if (gesture?.type === 'brush') {
    if (canceled) history.cancel()
    else history.commit()
    markMask()
  }
  if (gesture?.type === 'lasso' && (canceled || points.value.length < 3)) points.value = gesture.previous
  if (gesture?.type === 'prompt' && !canceled) {
    const end = pointerPosition(event, stage.value)
    if (Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) <= 8) {
      const selected = toImage(end)
      const label = gesture.label
      const next = updatePrompt(prompts.value, { x: selected.x / frame.width, y: selected.y / frame.height, type: label }, frame)
      if (next === prompts.value) {
        feedback.value = 'Já existe uma indicação igual aqui. Experimente tocar em outra região.'
      } else if (next.length <= 16) {
        promptUndo.value = [...promptUndo.value.slice(-15), prompts.value]
        prompts.value = next
        message.value = ''
        feedback.value = ''
        if (phase.value === 'mask') infer(label)
      } else message.value = 'Limite de 16 indicações. Remova uma indicação ou corrija com o pincel.'
    }
  }
  gesture = undefined
  if (event.pointerType !== 'mouse') cursor = undefined
  refresh()
}

function resetView() {
  pan = { x: 0, y: 0 }
  zoom.value = 1
  refresh()
}

function clearContour() {
  points.value = []
  message.value = ''
}

function enterReview() {
  phase.value = 'mask'
  tool.value = 'erase'
  markMask()
}

function processContour() {
  if (!validContour.value || busy.value || pointers.size) return
  message.value = ''
  try {
    history.setBase(() => contourMask(frame, points.value), true)
    variant.value = 'contour'
    enterReview()
  } catch {
    message.value = 'Não foi possível criar a máscara nas dimensões da foto. Tente um contorno menor.'
  }
}

function boxPrompt() {
  if (!validContour.value) return undefined
  const { x, y, width, height } = contourRegion(points.value, frame)
  if (!width || !height) return undefined
  return { x: x / frame.width, y: y / frame.height, right: (x + width) / frame.width, bottom: (y + height) / frame.height }
}

function reportProgress(progress) {
  const messages = {
    download: 'Carregando o modelo local…', encode: 'Analisando a fotografia…',
    decode: 'Separando o objeto…', fallback: 'Tentando a IA pela CPU (WASM)…',
  }
  busy.value = messages[progress.step]
  percent.value = progress.step === 'download' ? Math.round(100 * progress.loaded / progress.total) : null
}

function applyResult(result, task) {
    const { logits, side, imageSize, region, backend } = result

  let selected = 0
  let minX = side
  let minY = side
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (logits[y * side + x] <= 0) continue

      selected++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  const diagnostic = {
    backend,
    frame,
    image: { width: image.width, height: image.height },
    imageSize,
    region,
    maskSide: side,
    selectedPixels: selected,
    maskBounds: selected
      ? { minX, minY, maxX, maxY }
      : null,
  }

  console.log('DIAGNOSTICO MOBILE SAM:', diagnostic)
  window.__samDiagnostic = diagnostic
  const polygons = maskPolygons(result.logits, result.side, result.imageSize, frame, result.region)
  history.setBase(() => polygonMask(frame, polygons), phase.value !== 'mask')
  if (task.label && accepted) {
    const before = accepted.result
    const sameRegion = ['x', 'y', 'width', 'height'].every((key) => result.region[key] === before.region[key])
    const changed = !sameRegion || result.logits.some((value, index) => (value > 0) !== (before.logits[index] > 0))
    if (result.correctionSatisfied === false) {
      feedback.value = task.label === 'positive'
        ? 'A IA não conseguiu incluir essa área. Toque mais para dentro ou use Restaurar.'
        : 'A IA não conseguiu excluir essa área. Marque outro ponto ou use Apagar.'
    } else {
      feedback.value = changed ? 'Recorte atualizado.' : 'Essa área já está como indicada.'
    }
  }
  accepted = { ...task, result }
  manualAvailable.value = false
  maskSnapshots.set(task.key, result)
  if (maskSnapshots.size > 17) maskSnapshots.delete(maskSnapshots.keys().next().value)
  variant.value = 'ai'
  phase.value = 'mask'
  showOriginal.value = false
  if (!['positive', 'negative'].includes(tool.value)) tool.value = 'positive'
  inference.value = { backend: result.backend, startupMs: result.startupMs, encodingMs: result.encodingMs, decodingMs: result.decodingMs }
  verifyAiCache(result.assets).then((verified) => { if (!disposed && accepted?.result === result) aiCached.value = verified })
  markMask()
}

async function infer(label) {
  if (!validSelection.value || (busy.value && !running) || pointers.size) return
  const box = boxPrompt()
  requested = { points: prompts.value, undo: promptUndo.value, box, label, key: JSON.stringify([box, prompts.value]) }
  if (running) return
  running = true
  busy.value = 'Preparando a IA local…'
  message.value = ''
  try {
    while (requested && !disposed) {
      const task = requested
      requested = undefined
      try {
        segmenter ??= createMobileSam(image)
        const result = maskSnapshots.get(task.key) ??
          await segmenter.predict(task.points, task.box, reportProgress, task.label && accepted?.result)
        if (!disposed && !requested) applyResult(result, task)
      } catch (error) {
        if (error.name === 'AbortError' || disposed || requested) continue
        if (accepted) {
          prompts.value = accepted.points
          promptUndo.value = accepted.undo
        }
        showOriginal.value = false
        manualAvailable.value = true
        console.warn('MobileSAM:', error.message)
        if (error.message.startsWith('O modelo não encontrou')) message.value = error.message
        else if (!navigator.onLine) message.value = 'A IA local não conseguiu gerar o recorte offline. Conecte-se para verificar os arquivos do modelo ou use o recorte manual.'
        else message.value = 'A IA local não conseguiu gerar o recorte neste dispositivo. Você pode usar o recorte manual.'
      }
    }
  } finally {
    running = false
    percent.value = null
    busy.value = ''
  }
}

function removePrompt() {
  if (!canUndoPrompt.value || busy.value) return
  prompts.value = promptUndo.value.at(-1)
  promptUndo.value = promptUndo.value.slice(0, -1)
  feedback.value = ''
  if (phase.value === 'mask' && validSelection.value) infer()
}

function selectMode(useManual, reset = false) {
  if (busy.value || pointers.size) return
  if (useManual || reset) {
    segmenter?.dispose()
    segmenter = undefined
    inference.value = undefined
    aiCached.value = false
    accepted = undefined
    maskSnapshots.clear()
  }
  history.dispose()
  releaseImage(restoredBitmap)
  restoredBitmap = undefined
  if (reset) {
    prompts.value = []
    promptUndo.value = []
    points.value = []
  }
  manual.value = useManual
  phase.value = 'contour'
  tool.value = useManual ? 'lasso' : 'positive'
  showOriginal.value = false
  message.value = ''
  feedback.value = ''
  manualAvailable.value = false
}

function brushTool(value) {
  showOriginal.value = false
  tool.value = value
}

function undo() {
  history.undo()
  markMask()
}

function redo() {
  history.redo()
  markMask()
}

async function confirm(saveInLibrary = false) {
  if (busy.value || pointers.size) return
  busy.value = 'Aplicando transparência…'
  message.value = ''
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const result = await finishMask({ ...asset, ...frame }, history.mask, image)
    if (!disposed) emit('confirm', result, saveInLibrary)
  } catch (error) {
    if (!disposed) message.value = error.message
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <main class="cutout-page">
    <header class="cutout-header"
      :data-ai-provider="inference?.backend" :data-ai-startup-ms="inference?.startupMs"
      :data-ai-encoding-ms="inference?.encodingMs" :data-ai-decoding-ms="inference?.decodingMs">
      <div class="cutout-title"><span class="editor-symbol"><Scissors :size="22" /></span><div>
        <h1>{{ phase === 'mask' ? 'Refine o recorte' : manual ? 'Contorne o objeto' : 'Selecione o objeto' }}</h1>
        <p v-if="phase === 'mask'">{{ method }} · {{ variant === 'ai' ? 'Toque para manter ou remover áreas da foto.' : 'Use o pincel para corrigir a transparência.' }}</p>
        <p v-else-if="manual">Siga a borda do objeto. O traço se fecha quando você solta.</p>
        <p v-else-if="tool === 'lasso'">Desenhe um contorno aproximado. A IA vai procurar o objeto nessa região.</p>
        <p v-else>Toque no objeto que deseja manter e gere uma prévia.</p>
      </div></div>
      <QBtn flat round aria-label="Cancelar recorte" :disable="busy === 'Aplicando transparência…'" @click="emit('cancel')"><X :size="24" /></QBtn>
    </header>

    <div class="cutout-stage">
      <canvas ref="stage" class="interactive-canvas" :class="{ 'pan-cursor': tool === 'pan' }"
        :aria-label="phase === 'contour' || showOriginal ? 'Foto do objeto' : 'Prévia da máscara sobre ' + (solid ? 'fundo sólido' : 'fundo quadriculado')"
        @pointerdown="down" @pointermove="move" @pointerup="end" @pointercancel="end($event, true)"
        @lostpointercapture="end($event, true)" @pointerleave="cursor = undefined; refresh()"
        @wheel.prevent="!busy && adjustZoom(zoom * (1 + Math.sign(-$event.deltaY) * 0.15), pointerPosition($event, stage))">
      </canvas>
      <div v-if="busy" class="canvas-busy cutout-busy" role="status">
        <div><QSpinner size="25px" /> {{ busy }}</div>
        <progress v-if="percent !== null" :value="percent" max="100" aria-label="Carregamento da IA local"></progress>
      </div>
      <span class="canvas-tag">{{ Math.round(zoom * 100) }}%</span>
      <p v-if="feedback" class="cutout-feedback" role="status">{{ feedback }}</p>
    </div>

    <footer class="cutout-controls">
      <p v-if="message" class="inline-warning" role="status">{{ message }}</p>
      <div v-if="canPrompt" class="cutout-tools">
        <div class="tool-group" aria-label="Indicações para a IA">
          <QBtn flat no-caps class="btn" :class="{ active: tool === 'positive' }" :aria-pressed="tool === 'positive'" :disable="!!busy && phase !== 'mask'" @click="tool = 'positive'"><Plus :size="18" /> Manter</QBtn>
          <QBtn flat no-caps class="btn" :class="{ active: tool === 'negative' }" :aria-pressed="tool === 'negative'" :disable="!!busy && phase !== 'mask'" @click="tool = 'negative'"><Minus :size="18" /> Remover</QBtn>
          <QBtn v-if="phase === 'contour'" flat no-caps class="btn" :class="{ active: tool === 'lasso' }" :aria-pressed="tool === 'lasso'" :disable="!!busy" @click="tool = 'lasso'"><Lasso :size="18" /> Contorno guia</QBtn>
          <QBtn v-if="promptUndo.length" flat round aria-label="Desfazer indicação" title="Desfazer indicação"
            :disable="!!busy || !canUndoPrompt" @click="removePrompt"><Undo2 :size="18" /></QBtn>
        </div>
        <QBtn v-if="phase === 'mask'" flat no-caps class="btn" :aria-pressed="showOriginal"
          @click="showOriginal = !showOriginal; if (showOriginal && ['erase', 'restore'].includes(tool)) tool = 'positive'">
          {{ showOriginal ? 'Ver recorte' : 'Ver foto' }}
        </QBtn>
      </div>
      <div class="cutout-tools">
        <div class="tool-group" aria-label="Ferramentas do recorte">
          <QBtn v-if="phase === 'contour' && manual" flat no-caps class="btn" :class="{ active: tool === 'lasso' }" :aria-pressed="tool === 'lasso'" @click="tool = 'lasso'"><Lasso :size="18" /> Contorno</QBtn>
          <template v-if="phase === 'mask'">
            <QBtn flat no-caps class="btn" :class="{ active: tool === 'erase' }" :aria-pressed="tool === 'erase'" :disable="!!busy" @click="brushTool('erase')"><Eraser :size="18" /> Apagar</QBtn>
            <QBtn flat no-caps class="btn" :class="{ active: tool === 'restore' }" :aria-pressed="tool === 'restore'" :disable="!!busy" @click="brushTool('restore')"><Paintbrush :size="18" /> Restaurar</QBtn>
          </template>
          <QBtn flat no-caps class="btn" :class="{ active: tool === 'pan' }" :aria-pressed="tool === 'pan'" @click="tool = 'pan'"><Hand :size="18" /> Mover foto</QBtn>
        </div>
        <div class="tool-group">
          <label v-if="phase === 'mask'" class="range-inline"><span>Pincel</span><input v-model.number="brush" type="range" min="4" :max="brushMax" aria-label="Tamanho do pincel"></label>
          <label class="range-inline"><ZoomIn :size="17" aria-hidden="true" /><input type="range" :value="zoom" min="1" max="6" step="0.05" aria-label="Zoom da fotografia" @input="adjustZoom($event.target.value)"></label>
          <QBtn flat round aria-label="Recentrar fotografia" title="Recentrar fotografia" @click="resetView"><RotateCcw :size="17" /></QBtn>
          <template v-if="phase === 'mask'">
            <QBtn flat round aria-label="Desfazer pincelada" title="Desfazer pincelada" :disable="!canUndo || !!busy" @click="undo"><Undo2 :size="19" /></QBtn>
            <QBtn flat round aria-label="Refazer pincelada" title="Refazer pincelada" :disable="!canRedo || !!busy" @click="redo"><Redo2 :size="19" /></QBtn>
          </template>
        </div>
      </div>
      <div class="cutout-actions">
        <template v-if="phase === 'contour' && !manual">
          <QBtn v-if="manualAvailable" no-caps flat class="btn" :disable="!!busy" @click="selectMode(true)">Recorte manual</QBtn>
          <QBtn v-if="validContour" no-caps flat class="btn" :disable="!!busy" @click="clearContour">Limpar contorno</QBtn>
          <QBtn no-caps unelevated class="btn btn-primary" :disable="!validSelection || !!busy" @click="infer()"><Sparkles :size="18" /> Remover fundo</QBtn>
        </template>
        <template v-else-if="phase === 'contour'">
          <QBtn no-caps flat class="btn" @click="selectMode(false)">Voltar para IA</QBtn>
          <QBtn no-caps unelevated class="btn btn-primary" :disable="!validContour" @click="processContour"><Scissors :size="18" /> Recortar pelo contorno</QBtn>
        </template>
        <template v-else>
          <span v-if="aiCached && variant === 'ai'" class="ai-offline-note" role="status">IA disponível offline</span>
          <QBtn v-if="manualAvailable && !manual" no-caps flat class="btn" :disable="!!busy" @click="selectMode(true)">Recorte manual</QBtn>
          <QBtn flat no-caps class="btn" :class="{ 'matte-active': solid }" :aria-pressed="solid" @click="solid = !solid">Fundo sólido</QBtn>
          <QBtn no-caps flat class="btn" :disable="!!busy" @click="selectMode(manual, variant !== 'contour')">{{ manual ? 'Voltar ao contorno' : 'Nova seleção' }}</QBtn>
          <QBtn no-caps flat class="btn btn-text" :disable="!!busy" @click="confirm(true)">Salvar em Meus Recortes</QBtn>
          <QBtn no-caps unelevated class="btn btn-primary" :disable="!!busy" @click="confirm()"><Check :size="18" /> Confirmar recorte</QBtn>
        </template>
      </div>
    </footer>
  </main>
</template>
