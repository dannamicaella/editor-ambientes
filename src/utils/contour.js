export function rasterizeContour(points, width, height) {
  const mask = new Uint8Array(width * height)
  if (points.length < 3) return mask
  const edges = points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length]
    return point.y === next.y ? [] : [[point, next]]
  })
  for (let y = 0; y < height; y++) {
    const line = y + 0.5
    const intersections = []
    for (const [a, b] of edges) {
      if ((a.y > line) === (b.y > line)) continue
      intersections.push(a.x + (line - a.y) * (b.x - a.x) / (b.y - a.y))
    }
    intersections.sort((a, b) => a - b)
    for (let n = 0; n + 1 < intersections.length; n += 2) {
      const start = Math.max(0, Math.ceil(intersections[n] - 0.5))
      const end = Math.min(width, Math.ceil(intersections[n + 1] - 0.5))
      if (end > start) mask.fill(1, y * width + start, y * width + end)
    }
  }
  return mask
}