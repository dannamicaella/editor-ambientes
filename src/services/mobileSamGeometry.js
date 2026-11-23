
export const SAM_SIZE = 1024
export const FULL_IMAGE = { x: 0, y: 0, width: 1, height: 1 }
const LABELS = { negative: 0, positive: 1 }

export function resizedImage(width, height) {
  const scale = SAM_SIZE / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function guidedRegion(width, height, box) {
  if (!box) return FULL_IMAGE
  const marginX = Math.max(0.035, (box.right - box.x) * 0.38)
  const marginY = Math.max(0.035, (box.bottom - box.y) * 0.38)
  const left = Math.max(0, Math.floor((box.x - marginX) * width))
  const top = Math.max(0, Math.floor((box.y - marginY) * height))
  const right = Math.min(width, Math.ceil((box.right + marginX) * width))
  const bottom = Math.min(height, Math.ceil((box.bottom + marginY) * height))
  return {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  }
}

export function containsPrompt(region, { x, y }) {
  return x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
}

export function relativePrompts(points, box, region) {
  const map = ({ x, y }) => ({
    x: (x - region.x) / region.width,
    y: (y - region.y) / region.height,
  })
  const mapped = points
    .filter((point) => containsPrompt(region, point))
    .map((point) => ({ ...map(point), type: point.type }))

  if (!box) return { points: mapped }

  const { x, y } = map({ x: box.right, y: box.bottom })
  return {
    points: mapped,
    box: { ...map(box), right: x, bottom: y },
  }
}

export function modelPrompts(points, box, size) {
  const inputs = points.map(({ x, y, type }) => ({
    x, y, label: LABELS[type],
  }))

  if (box) {
    inputs.push(
      { x: box.x, y: box.y, label: 2 },
      { x: box.right, y: box.bottom, label: 3 },
    )
  } else {
    inputs.push({ x: 0, y: 0, label: -1 })
  }

  return {
    coordinates: Float32Array.from(
      inputs.flatMap(({ x, y }) => [x * size.width, y * size.height]),
    ),
    labels: Float32Array.from(inputs.map(({ label }) => label)),
  }
}

export function updatePrompt(points, point, frame) {
  const distance = Math.max(2, Math.max(frame.width, frame.height) / 320)
  const nearby = (other) =>
    Math.hypot(
      (other.x - point.x) * frame.width,
      (other.y - point.y) * frame.height,
    ) <= distance

  const match = points.findLast(nearby)
  if (match?.type === point.type) return points

  return [...points.filter((other) => !nearby(other)), point]
}

export function bestMask(logits, scores, side, points, box, size) {
  return selectMask(logits, scores, side, points, box, size).logits
}

function promptIndex(point, side, size, width, height) {
  const column = Math.min(
    width - 1,
    Math.max(0, Math.floor(point.x * size.width * side / SAM_SIZE)),
  )
  const row = Math.min(
    height - 1,
    Math.max(0, Math.floor(point.y * size.height * side / SAM_SIZE)),
  )
  return row * side + column
}

function protectInterior(mask, side, width, height, indices, points, previous) {
  const seen = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const positive = new Set()
  const negative = new Set()
  let enclosed = 0

  points.forEach(({ type }, i) =>
    (type === 'positive' ? positive : negative).add(indices[i]),
  )

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * side + x
      if (mask[start] > 0 || seen[start]) continue

      let head = 0
      let tail = 0
      let exterior = false
      let included = false
      let excluded = false
      let previouslyIncluded = 0

      function visit(index) {
        if (mask[index] > 0 || seen[index]) return
        seen[index] = 1
        queue[tail++] = index
      }

      visit(start)

      while (head < tail) {
        const index = queue[head++]
        const column = index % side
        const row = Math.floor(index / side)

        if (
          column === 0 ||
          column === width - 1 ||
          row === 0 ||
          row === height - 1
        ) exterior = true

        if (positive.has(index)) included = true
        if (negative.has(index)) excluded = true
        if (previous?.[index] > 0) previouslyIncluded++

        if (column > 0) visit(index - 1)
        if (column + 1 < width) visit(index + 1)
        if (row > 0) visit(index - side)
        if (row + 1 < height) visit(index + side)
      }

      // Preserve interior regions unless explicitly excluded.
      if (exterior || excluded) continue

      if (
        included ||
        tail <= 16 ||
        previouslyIncluded >= tail * 0.9
      ) {
        for (let i = 0; i < tail; i++) {
          mask[queue[i]] = Math.max(0.25, -mask[queue[i]])
        }
      } else {
        enclosed += tail
      }
    }
  }

  return enclosed
}

export function selectMask(
  logits, scores, side, points, box, size,
  previous, correction, latest,
) {
  const length = side * side
  const validWidth = Math.ceil(size.width * side / SAM_SIZE)
  const validHeight = Math.ceil(size.height * side / SAM_SIZE)
  const indices = points.map((point) =>
    promptIndex(point, side, size, validWidth, validHeight),
  )

  let best

  for (let candidate = 0; candidate < scores.length; candidate++) {
    const raw = logits.subarray(
      candidate * length,
      (candidate + 1) * length,
    )

    const mask = keepObjectComponents(
      raw, side, validWidth, validHeight, indices, points,
    )

    const enclosed = protectInterior(
      mask, side, validWidth, validHeight,
      indices, points, previous,
    )

    let count = 0
    let outside = 0
    let union = 0
    let intersection = 0

    for (let y = 0; y < validHeight; y++) {
      for (let x = 0; x < validWidth; x++) {
        const index = y * side + x
        const inside = mask[index] > 0
        const wasInside = previous?.[index] > 0

        if (inside || wasInside) union++
        if (inside && wasInside) intersection++
        if (!inside) continue

        count++
        if (!box) continue

        const nx = (x + 0.5) * SAM_SIZE / (side * size.width)
        const ny = (y + 0.5) * SAM_SIZE / (side * size.height)

        if (
          nx < box.x ||
          nx > box.right ||
          ny < box.y ||
          ny > box.bottom
        ) outside++
      }
    }

    if (!count) continue

    let penalty = 0
    let correctionSatisfied = !correction

    points.forEach(({ type }, index) => {
      const satisfied =
        (mask[indices[index]] > 0) === (type === 'positive')

      if (index === latest) correctionSatisfied = satisfied

      if (!satisfied) {
        penalty += correction && index === latest ? 6 : 2
      }
    })

    const continuity = previous && union
      ? intersection / union
      : 0

    const score =
      scores[candidate] -
      penalty -
      0.5 * outside / count -
      2 * enclosed / (count + enclosed) +
      0.55 * continuity

    if (!best || score > best.score) {
      best = { logits: mask, raw, score, correctionSatisfied }
    }
  }

  if (!best) {
    throw new Error(
      'O modelo não encontrou um objeto. Toque no centro do objeto ou indique um contorno aproximado.',
    )
  }

  return { ...best, raw: best.raw.slice() }
}

function keepObjectComponents(mask, side, width, height, indices, points) {
  const labels = new Int32Array(mask.length)
  const queue = new Int32Array(mask.length)
  let largest = 0
  let largestCount = 0
  let component = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * side + x
      if (!(mask[start] > 0) || labels[start]) continue

      let head = 0
      let tail = 0
      component++

      function visit(index) {
        if (!(mask[index] > 0) || labels[index]) return
        labels[index] = component
        queue[tail++] = index
      }

      visit(start)

      while (head < tail) {
        const index = queue[head++]
        const column = index % side

        if (column > 0) visit(index - 1)
        if (column + 1 < width) visit(index + 1)
        if (index >= side) visit(index - side)
        if (index + side < height * side) visit(index + side)
      }

      if (tail > largestCount) {
        largest = component
        largestCount = tail
      }
    }
  }

  const keep = new Set()

  points.forEach(({ type }, index) => {
    if (type === 'positive' && labels[indices[index]]) {
      keep.add(labels[indices[index]])
    }
  })

  if (!keep.size) keep.add(largest)

  return Float32Array.from(mask, (value, index) =>
    value > 0 && !keep.has(labels[index]) ? -value : value,
  )
}

// Remove narrow background attachments from the displayed contour only.
// The raw model logits and interactive refinement remain unchanged.
function cleanContourMask(logits, side, width, height) {
  const count = width * height
  if (count < 100) return logits

  const inside = new Uint8Array(side * side)
  const eroded = new Uint8Array(side * side)
  const opened = new Uint8Array(side * side)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * side + x
      inside[index] = logits[index] > 0 ? 1 : 0
    }
  }

  // A two-pixel-radius opening breaks thin bridges to background fragments.
  const radius = 2
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let complete = true
      for (let dy = -radius; dy <= radius && complete; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          if (!inside[(y + dy) * side + x + dx]) {
            complete = false
            break
          }
        }
      }
      if (complete) eroded[y * side + x] = 1
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let filled = false
      for (let dy = -radius; dy <= radius && !filled; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width || dx * dx + dy * dy > radius * radius) continue
          if (eroded[ny * side + nx]) {
            filled = true
            break
          }
        }
      }
      if (filled) opened[y * side + x] = 1
    }
  }

  // Retain the largest connected area after narrow bridges are removed.
  const seen = new Uint8Array(side * side)
  const queue = new Int32Array(side * side)
  let largest = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * side + x
      if (!opened[start] || seen[start]) continue
      const component = []
      let head = 0
      let tail = 0
      queue[tail++] = start
      seen[start] = 1
      while (head < tail) {
        const index = queue[head++]
        component.push(index)
        const cx = index % side
        const cy = Math.floor(index / side)
        for (const next of [
          cx > 0 ? index - 1 : -1,
          cx + 1 < width ? index + 1 : -1,
          cy > 0 ? index - side : -1,
          cy + 1 < height ? index + side : -1,
        ]) {
          if (next < 0 || seen[next] || !opened[next]) continue
          seen[next] = 1
          queue[tail++] = next
        }
      }
      if (component.length > largest.length) largest = component
    }
  }

  // If the opening removes too much, keep the original segmentation.
  let originalCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) originalCount += inside[y * side + x]
  }
  if (!originalCount || largest.length < originalCount * 0.65) return logits

  const cleaned = Float32Array.from(logits)
  const keep = new Uint8Array(side * side)
  for (const index of largest) keep[index] = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * side + x
      if (!keep[index]) cleaned[index] = -Math.max(0.5, Math.abs(cleaned[index]))
      else cleaned[index] = Math.max(0.5, cleaned[index])
    }
  }
  return cleaned
}

// Smooth only the contour input, leaving AI mask selection unchanged.
function smoothContourLogits(logits, side, width, height) {
  const output = new Float32Array(logits)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weightSum = 0

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue

        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue

          const weight = dx === 0 && dy === 0
            ? 4
            : dx === 0 || dy === 0
              ? 2
              : 1

          sum += logits[ny * side + nx] * weight
          weightSum += weight
        }
      }

      output[y * side + x] = sum / weightSum
    }
  }

  return output
}

// Trace an iso-contour through the model logits.
export function maskPolygons(
  logits, side, size, frame, region = FULL_IMAGE,
) {
  const validWidth = Math.ceil(size.width * side / SAM_SIZE)
  const validHeight = Math.ceil(size.height * side / SAM_SIZE)

  const cleanedLogits = cleanContourMask(
    logits, side, validWidth, validHeight,
  )
  const smoothLogits = smoothContourLogits(
    cleanedLogits, side, validWidth, validHeight,
  )

  const vertex = (x, y) => {
    const inPhoto =
      x >= 0 && y >= 0 &&
      x < validWidth && y < validHeight

    const borderX = Math.max(
      0, Math.min(validWidth - 1, x),
    )
    const borderY = Math.max(
      0, Math.min(validHeight - 1, y),
    )

    const value = smoothLogits[borderY * side + borderX]

    return {
      x,
      y,
      value: inPhoto
        ? value
        : -Math.max(0.01, Math.abs(value)),
    }
  }

  const edges = new Map()

  function cross(a, b) {
    const key = [a.x, a.y, b.x, b.y].join(',')
    let edge = edges.get(key)

    if (!edge) {
      const denominator = a.value - b.value
      const t = denominator === 0
        ? 0.5
        : a.value / denominator

      const x =
        (a.x + 0.5 + t * (b.x - a.x)) *
        SAM_SIZE / side

      const y =
        (a.y + 0.5 + t * (b.y - a.y)) *
        SAM_SIZE / side

      edge = {
        point: {
          x: (
            region.x +
            Math.max(0, Math.min(1, x / size.width)) *
            region.width
          ) * frame.width,

          y: (
            region.y +
            Math.max(0, Math.min(1, y / size.height)) *
            region.height
          ) * frame.height,
        },
        neighbors: [],
      }

      edges.set(key, edge)
    }

    return edge
  }

  function join(a, b) {
    a.neighbors.push(b)
    b.neighbors.push(a)
  }

  for (let y = -1; y < validHeight; y++) {
    for (let x = -1; x < validWidth; x++) {
      const [a, b, c, d] = [
        vertex(x, y),
        vertex(x + 1, y),
        vertex(x + 1, y + 1),
        vertex(x, y + 1),
      ]

      const pairs = [
        [a, b],
        [b, c],
        [d, c],
        [a, d],
      ]

      const crossings = pairs
        .filter(([left, right]) =>
          (left.value > 0) !== (right.value > 0),
        )
        .map(([left, right]) => cross(left, right))

      if (crossings.length === 2) {
        join(...crossings)
      }

      if (crossings.length === 4) {
        const center =
          a.value + b.value + c.value + d.value > 0

        if (center === (a.value > 0)) {
          join(crossings[0], crossings[1])
          join(crossings[2], crossings[3])
        } else {
          join(crossings[0], crossings[3])
          join(crossings[1], crossings[2])
        }
      }
    }
  }

  const visited = new Set()
  const polygons = []

  for (const first of edges.values()) {
    if (visited.has(first)) continue

    const path = []
    let previous
    let current = first

    while (current && !visited.has(current)) {
      visited.add(current)
      path.push(current.point)

      const next = current.neighbors.find(
        (edge) => edge !== previous,
      )

      previous = current
      current = next
    }

    if (current === first && path.length >= 3) {
      polygons.push(path)
    }
  }

  return polygons
}
