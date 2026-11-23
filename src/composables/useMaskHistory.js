import { computed, ref } from 'vue'
import { releaseImage } from '../services/images.js'
import { strokeMask } from '../services/masks.js'

export function useMaskHistory(frame) {
  let base
  let working
  let active
  const done = []
  const undone = []
  const revision = ref(0)
  let undoFloor = 0
  const canUndo = computed(() => revision.value >= 0 && done.length > undoFloor)
  const canRedo = computed(() => revision.value >= 0 && undone.length > 0)

  function paint(mask, stroke) {
    stroke.points.forEach((point, index) => strokeMask(mask, frame, stroke, stroke.points[index - 1], point))
  }

  function setBase(factory, reset = false) {
    const next = factory()
    try {
      if (!reset) for (const stroke of done) paint(next, stroke)
    } catch (error) {
      releaseImage(next.canvas)
      throw error
    }
    releaseImage(working?.canvas)
    if (reset) {
      done.length = undone.length = 0
      active = undefined
      undoFloor = 0
    }
    working = next
    base = factory
    revision.value++
  }

  function begin(tool, width, point) {
    active = { tool, width, points: [point] }
    strokeMask(working, frame, active, null, point)
  }

  function append(point) {
    if (!active) return
    const previous = active.points.at(-1)
    if (Math.hypot(previous.x - point.x, previous.y - point.y) < 0.65) return
    active.points.push(point)
    strokeMask(working, frame, active, previous, point)
  }

  function commit() {
    if (!active) return
    done.push(active)
    active = undefined
    undone.length = 0
    undoFloor = Math.max(undoFloor, done.length - 24)
    revision.value++
  }

  function cancel() {
    if (!active) return
    active = undefined
    setBase(base)
  }

  function undo() {
    if (done.length <= undoFloor) return
    undone.push(done.pop())
    setBase(base)
  }

  function redo() {
    if (!undone.length) return
    const stroke = undone.pop()
    done.push(stroke)
    paint(working, stroke)
    revision.value++
  }

  function dispose() {
    releaseImage(working?.canvas)
    working = base = active = undefined
    done.length = undone.length = 0
    undoFloor = 0
    revision.value++
  }

  return { setBase, begin, append, commit, cancel, undo, redo, dispose, canUndo, canRedo, get mask() { return working } }
}