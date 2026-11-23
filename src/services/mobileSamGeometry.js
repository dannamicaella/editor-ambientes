export const SAM_SIZE = 1024
export const FULL_IMAGE = { x: 0, y: 0, width: 1, height: 1 }
export const NO_OBJECT = 'O modelo não encontrou um objeto. Toque no centro do objeto ou indique um contorno aproximado.'
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

export function prefersMask(candidate, previous) {
  if (!previous) return true
  if (candidate.correctionSatisfied !== previous.correctionSatisfied) return candidate.correctionSatisfied
  return candidate.score > previous.score
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
  previous, correction, latest, diagnostics, negativeCandidates,
) {
  const length = side * side
  const validWidth = Math.ceil(size.width * side / SAM_SIZE)
  const validHeight = Math.ceil(size.height * side / SAM_SIZE)
  const indices = points.map((point) =>
    promptIndex(point, side, size, validWidth, validHeight),
  )
  // Match the component lookup for an initial single click. Interpolation can cross
  // a cell boundary and penalize the whole object in favor of a local detail.
  const initialPositive = !box && !previous && !correction && points.length === 1 && points[0].type === 'positive'

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
      const value = initialPositive ? mask[indices[index]] : samLogitAt(mask, side, size, points[index])
      const satisfied = (value > 0) === (type === 'positive')

      if (index === latest) correctionSatisfied = satisfied

      if (!satisfied) {
        penalty += 2
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

    if (diagnostics) diagnostics.push({
      candidate,
      modelScore: Number(scores[candidate].toFixed(4)),
      finalScore: Number(score.toFixed(4)),
      selectedPixels: count,
      outsideBoxPercent: box ? Number((100 * outside / count).toFixed(2)) : null,
      promptPenalty: penalty,
      correctionSatisfied,
    })

    const selection = { logits: mask, raw, score, correctionSatisfied, candidate }
    if (negativeCandidates && correction && correctionSatisfied && !penalty) negativeCandidates.push(selection)
    if (prefersMask(selection, best)) best = selection
  }

  if (!best) {
    throw new Error(NO_OBJECT)
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

  // Upsampling before unpadding still reads the adjoining logit samples.
  const result = new Float32Array(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * side + x
      if (mask[index] > 0 && !keep.has(labels[index])) result[index] = -mask[index]
    }
  }
  return result
}

export function guideBox(points, box) {
  if (!box) return undefined
  const region = { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y }
  return points.some((point) => point.type === 'positive' && !containsPrompt(region, point)) ? undefined : box
}

function axisSamples(count, coordinate, length) {
  const low = new Int32Array(count)
  const high = new Int32Array(count)
  const fraction = new Float32Array(count)
  const interior = new Uint8Array(count)
  for (let index = 0; index < count; index++) {
    const raw = coordinate(index)
    const value = Math.min(length - 1, Math.max(0, raw))
    low[index] = Math.floor(value)
    high[index] = Math.min(length - 1, low[index] + 1)
    fraction[index] = value - low[index]
    interior[index] = raw >= 0 && raw <= length - 1
  }
  return { low, high, fraction, interior }
}

function interpolate(a, b, ratio) {
  return a + (b - a) * ratio
}

function gridSample(values, side, x, y) {
  const left = Math.min(side - 1, Math.max(0, x))
  const top = Math.min(side - 1, Math.max(0, y))
  const x0 = Math.floor(left)
  const y0 = Math.floor(top)
  const x1 = Math.min(side - 1, x0 + 1)
  const y1 = Math.min(side - 1, y0 + 1)
  return interpolate(
    interpolate(values[y0 * side + x0], values[y0 * side + x1], left - x0),
    interpolate(values[y1 * side + x0], values[y1 * side + x1], left - x0),
    top - y0,
  )
}

export function samLogitAt(values, side, size, point) {
  const x = Math.max(0, Math.min(size.width - 1, point.x * size.width - 0.5))
  const y = Math.max(0, Math.min(size.height - 1, point.y * size.height - 0.5))
  const scale = side / SAM_SIZE
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const at = (column, row) => gridSample(values, side,
    (Math.min(size.width - 1, column) + 0.5) * scale - 0.5,
    (Math.min(size.height - 1, row) + 0.5) * scale - 0.5)
  return interpolate(
    interpolate(at(x0, y0), at(x0 + 1, y0), x - x0),
    interpolate(at(x0, y0 + 1), at(x0 + 1, y0 + 1), x - x0),
    y - y0,
  )
}
// The official SAM path resizes the logits to the padded square before removing the padding.
export function unpadLogits(logits, side, { width, height }) {
  const scale = side / SAM_SIZE
  const horizontal = axisSamples(width, (x) => (x + 0.5) * scale - 0.5, side)
  const vertical = axisSamples(height, (y) => (y + 0.5) * scale - 0.5, side)
  const result = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const top = vertical.low[y] * side
    const bottom = vertical.high[y] * side
    for (let x = 0; x < width; x++) {
      const left = horizontal.low[x]
      const right = horizontal.high[x]
      const ratio = horizontal.fraction[x]
      result[y * width + x] = interpolate(
        interpolate(logits[top + left], logits[top + right], ratio),
        interpolate(logits[bottom + left], logits[bottom + right], ratio),
        vertical.fraction[y],
      )
    }
  }
  return result
}

function projectionAxis(origin, extent, first, last, length, frameLength) {
  const scale = length / extent
  const start = Math.max(0, Math.floor(origin), Math.floor(origin + (first - 1) / scale))
  const end = Math.min(frameLength, Math.ceil(origin + extent), Math.ceil(origin + (last + 2) / scale))
  const samples = axisSamples(end - start, (index) => (start + index + 0.5 - origin) * scale - 0.5, length)
  return {
    start, end, scale, ...samples,
    firstCoverage: Math.min(1, start + 1 - origin),
    lastCoverage: Math.min(1, origin + extent - end + 1),
  }
}

function regionCoverage(axis, index) {
  if (axis.end - axis.start === 1) return Math.max(0, axis.firstCoverage + axis.lastCoverage - 1)
  if (index === 0) return axis.firstCoverage
  if (index === axis.end - axis.start - 1) return axis.lastCoverage
  return 1
}

// Rasterize only the occupied source rectangle. A one-pixel footprint antialiases the zero level set.
export function samAlpha(logits, side, size, frame, region = FULL_IMAGE) {
  const { width, height } = size
  const values = unpadLogits(logits, side, size)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!(values[y * width + x] > 0)) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left) return undefined
  const x = projectionAxis(region.x * frame.width, region.width * frame.width, left, right, width, frame.width)
  const y = projectionAxis(region.y * frame.height, region.height * frame.height, top, bottom, height, frame.height)

  function writeAlpha(rgba, firstRow) {
    const stride = x.end - x.start
    const rows = rgba.length / (stride * 4)
    for (let row = 0; row < rows; row++) {
      const cy = firstRow + row
      const upper = y.low[cy] * width
      const lower = y.high[cy] * width
      const fy = y.fraction[cy]
      const clipY = regionCoverage(y, cy)
      for (let cx = 0; cx < stride; cx++) {
        const a = values[upper + x.low[cx]]
        const b = values[upper + x.high[cx]]
        const c = values[lower + x.low[cx]]
        const d = values[lower + x.high[cx]]
        const fx = x.fraction[cx]
        const upperValue = interpolate(a, b, fx)
        const lowerValue = interpolate(c, d, fx)
        const value = interpolate(upperValue, lowerValue, fy)
        const dx = x.interior[cx] ? interpolate(b - a, d - c, fy) * x.scale : 0
        const dy = y.interior[cy] ? (lowerValue - upperValue) * y.scale : 0
        const footprint = Math.abs(dx) + Math.abs(dy)
        const coverage = footprint ? Math.max(0, Math.min(1, 0.5 + value / footprint)) : Number(value > 0)
        rgba[(row * stride + cx) * 4 + 3] = Math.round(255 * coverage * clipY * regionCoverage(x, cx))
      }
    }
  }

  return { x: x.start, y: y.start, width: x.end - x.start, height: y.end - y.start, writeAlpha }
}
