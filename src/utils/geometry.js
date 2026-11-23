export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function fitSize(width, height, maxEdge, maxArea = Infinity) {
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxArea / (width * height)))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function contain(width, height, areaWidth, areaHeight) {
  const scale = Math.min(areaWidth / width, areaHeight / height)
  return {
    x: (areaWidth - width * scale) / 2,
    y: (areaHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  }
}

export function pointerPosition(event, element) {
  const rect = element.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

export function pointerPair(points) {
  const [a, b] = points.values()
  if (!b) return { ...a, distance: 1, angle: 0 }
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
  }
}

export function angleDegrees(x, y) {
  return Math.atan2(y, x) * 180 / Math.PI
}

export const wrapAngle = (angle) => ((angle + 180) % 360 + 360) % 360 - 180