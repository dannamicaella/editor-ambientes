import { nextTick, onBeforeUnmount, onMounted, reactive } from 'vue'

export function useCanvasViewport(element, draw) {
  const size = reactive({ width: 1, height: 1, ratio: 1 })
  let observer
  let frame

  function refresh() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const canvas = element.value
      if (canvas) draw(canvas)
    })
  }

  function resize() {
    const canvas = element.value
    if (!canvas) return
    size.width = Math.max(1, canvas.clientWidth)
    size.height = Math.max(1, canvas.clientHeight)
    size.ratio = Math.min(window.devicePixelRatio || 1, 2, 1800 / Math.max(size.width, size.height))
    canvas.width = Math.round(size.width * size.ratio)
    canvas.height = Math.round(size.height * size.ratio)
    refresh()
  }

  onMounted(async () => {
    await nextTick()
    observer = new ResizeObserver(resize)
    if (element.value) observer.observe(element.value)
    resize()
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame) cancelAnimationFrame(frame)
  })
  return { size, refresh }
}