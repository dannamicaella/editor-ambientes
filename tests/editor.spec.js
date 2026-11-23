import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

async function imageFile(page, kind) {
  const png = await page.evaluate((kind) => {
    const canvas = document.createElement('canvas')
    canvas.width = kind === 'fabric' ? 2600 : kind === 'background' ? 400 : 300
    canvas.height = kind === 'fabric' ? 1000 : kind === 'background' ? 300 : 240
    const context = canvas.getContext('2d')
    context.fillStyle = kind === 'background' ? '#769c9c' : '#353b46'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (kind === 'object') {
      context.fillStyle = '#c84c31'
      context.beginPath()
      context.ellipse(150, 120, 74, 48, 0, 0, 2 * Math.PI)
      context.fill()
      context.fillStyle = '#df674b'
      context.fillRect(121, 115, 58, 10)
    } else if (kind === 'fabric') {
      for (let y = 0; y < canvas.height; y++) {
        context.fillStyle = y % 2 ? '#e9e5dc' : '#f7f3e8'
        context.fillRect(0, y, canvas.width, 1)
      }
      context.fillStyle = '#164577'
      context.beginPath()
      context.ellipse(1120, 480, 180, 67, 0, 0, 2 * Math.PI)
      context.fill()
      context.beginPath()
      context.moveTo(960, 480)
      context.lineTo(880, 416)
      context.lineTo(880, 544)
      context.fill()
    } else {
      context.clearRect(0, 0, 18, 18)
    }
    return canvas.toDataURL().split(',')[1]
  }, kind)
  return { name: kind === 'background' ? 'Ambiente.png' : 'Almofada.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }
}

async function upload(page, file, camera = false) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (camera) await expect(dialog.locator('input[capture]')).toHaveAttribute('capture', 'environment')
  const picker = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: camera ? 'Fotografar' : 'Escolher da galeria' }).click()
  await (await picker).setFiles(file)
}

async function addObject(page, file, manual = true) {
  await page.locator('.editor-toolbar').getByRole('button', { name: 'Adicionar objeto' }).click()
  await upload(page, file)
  await expect(page.getByRole('heading', { name: 'Selecione o objeto' })).toBeVisible()
  if (manual) {
    await expect(page.getByRole('button', { name: 'Recorte manual' })).toHaveCount(0)
    await page.evaluate(() => {
      const OriginalWorker = window.Worker
      window.restoreWorkerForTest = () => { window.Worker = OriginalWorker }
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          if (String(url).includes('mobileSam.worker')) throw new Error('Motor indisponível no teste.')
          super(url, options)
        }
      }
    })
    const bounds = await page.locator('.cutout-stage canvas').boundingBox()
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.getByRole('button', { name: 'Remover fundo' }).click()
    await page.getByRole('button', { name: 'Recorte manual' }).click()
    await page.evaluate(() => window.restoreWorkerForTest())
    await expect(page.getByRole('heading', { name: 'Contorne o objeto' })).toBeVisible()
  }
  return page.locator('.cutout-stage canvas')
}

function imagePoint(rect, x, y, width = 300, height = 240, zoom = 1, panX = 0, panY = 0) {
  const scale = zoom * Math.min((rect.width - 32) / width, (rect.height - 32) / height)
  return {
    x: rect.x + (rect.width - width * scale) / 2 + x * scale + panX,
    y: rect.y + (rect.height - height * scale) / 2 + y * scale + panY,
  }
}

async function drawContour(page, canvas, points = [[58, 55], [242, 55], [242, 185], [58, 185], [58, 55]], dimensions = []) {
  const rect = await canvas.boundingBox()
  const first = imagePoint(rect, ...points[0], ...dimensions)
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const point of points.slice(1)) {
    const next = imagePoint(rect, ...point, ...dimensions)
    await page.mouse.move(next.x, next.y, { steps: 10 })
  }
  await page.mouse.up()
}

async function touchGesture(page, positions) {
  const session = await page.context().newCDPSession(page)
  try {
    for (const [index, points] of positions.entries()) {
      await session.send('Input.dispatchTouchEvent', {
        type: index ? 'touchMove' : 'touchStart',
        touchPoints: points.map((point, id) => ({ ...point, id })),
      })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

async function pixelAt(canvas, target) {
  return canvas.evaluate((element, target) => {
    const position = element.getBoundingClientRect()
    const x = Math.floor((target.x - position.x) * element.width / position.width)
    const y = Math.floor((target.y - position.y) * element.height / position.height)
    return Array.from(element.getContext('2d').getImageData(x, y, 1, 1).data)
  }, target)
}

async function setRange(locator, value) {
  await locator.evaluate((input, value) => {
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function decodedFile(page, download, points) {
  const png = await readFile(await download.path())
  return page.evaluate(async ({ bytes, points }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return {
      width: image.width, height: image.height, alpha: context.getImageData(5, 5, 1, 1).data[3],
      ...(points && { pixels: points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)) }),
    }
  }, { bytes: [...png], points })
}

test('importa, recorta pelo contorno, corrige, transforma, salva, reabre e exporta', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Editor de Ambientes' })).toBeVisible()
  const background = await imageFile(page, 'background')
  const object = await imageFile(page, 'object')
  await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
  await upload(page, background, true)
  await expect(page.getByText('400 × 300 px')).toBeVisible()
  await page.getByLabel('Nome da montagem').fill('Sala de atendimento')
  await page.getByLabel('Nome da montagem').press('Enter')
  const contourCanvas = await addObject(page, object)
  await drawContour(page, contourCanvas)
  await page.getByRole('button', { name: 'Recortar pelo contorno' }).click()
  await expect(page.getByRole('heading', { name: 'Refine o recorte' })).toBeVisible()
  await expect(page.getByText(/Recorte manual ·/)).toBeVisible()

  const rect = await contourCanvas.boundingBox()
  const center = imagePoint(rect, 150, 120)
  const outside = imagePoint(rect, 44, 45)
  await expect.poll(async () => (await pixelAt(contourCanvas, center))[0]).toBe(223)
  await expect.poll(async () => (await pixelAt(contourCanvas, outside))[0]).toBeGreaterThan(210)
  expect((await pixelAt(contourCanvas, imagePoint(rect, 66, 62))).slice(0, 3)).toEqual([53, 59, 70])
  await page.mouse.click(center.x, center.y)
  await expect.poll(async () => (await pixelAt(contourCanvas, center)).slice(0, 3)).not.toEqual([223, 103, 75])
  await page.getByRole('button', { name: 'Desfazer pincelada' }).click()
  await expect.poll(async () => (await pixelAt(contourCanvas, center))[1]).toBe(103)
  await page.getByRole('button', { name: 'Refazer pincelada' }).click()
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await page.mouse.click(center.x, center.y)
  await page.getByRole('button', { name: 'Confirmar recorte' }).click()

  const layers = page.getByRole('complementary', { name: 'Camadas e ajustes' })
  await expect(layers.getByRole('button', { name: 'Almofada', exact: true })).toBeVisible()
  const composition = page.locator('.composition-surface canvas')
  const frame = await composition.boundingBox()
  const midX = frame.x + frame.width / 2
  const midY = frame.y + frame.height / 2
  await page.mouse.move(midX, midY)
  await page.mouse.down()
  await page.mouse.move(midX + 78, midY - 37, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => Number(await page.getByLabel('Posição X').inputValue())).toBeGreaterThan(50)
  await setRange(page.getByRole('slider', { name: /Escala/ }), '58')
  await setRange(page.getByRole('slider', { name: /Rotação/ }), '32')
  await setRange(page.getByRole('slider', { name: 'Opacidade' }), '76')
  await page.getByLabel('Aplicar sombra').check()
  await expect(layers.getByText('58%')).toBeVisible()
  await expect(layers.getByText('32°')).toBeVisible()
  await page.getByRole('button', { name: 'Duplicar objeto' }).click()
  await expect(layers.getByRole('button', { name: 'Almofada (cópia)' })).toBeVisible()
  await expect(layers.getByText('32°')).toBeVisible()
  await page.getByLabel('Posição X').fill('32')
  await page.getByLabel('Posição X').press('Tab')
  await page.getByRole('button', { name: 'Descer camada' }).click()
  await page.getByRole('button', { name: 'Excluir objeto' }).click()
  await expect(layers.getByRole('button', { name: 'Almofada (cópia)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click()
  await expect(layers.getByRole('button', { name: 'Almofada (cópia)' })).toBeVisible()
  await page.getByRole('button', { name: 'Refazer', exact: true }).click()
  await expect(layers.getByRole('button', { name: 'Almofada (cópia)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click()

  await page.getByRole('button', { name: 'Salvar montagem' }).click()
  await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Abrir montagem Sala de atendimento' }).click()
  await layers.getByRole('button', { name: 'Almofada (cópia)' }).click()
  await expect(page.getByLabel('Posição X')).toHaveValue('32')
  await expect(layers.getByText('32°')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Opacidade' })).toHaveValue('76')
  await expect(page.getByLabel('Aplicar sombra')).toBeChecked()

  await page.getByRole('button', { name: 'Editar recorte' }).click()
  await expect(page.getByText(/Máscara salva/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar recorte' }).click()
  await page.getByRole('button', { name: 'Exportar montagem' }).click()
  const dialog = page.getByRole('dialog')
  const png = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Exportar e baixar' }).click()
  const pngFile = await png
  expect(pngFile.suggestedFilename()).toBe('Sala de atendimento.png')
  expect(await decodedFile(page, pngFile)).toEqual({ width: 400, height: 300, alpha: 0 })
  await dialog.getByLabel('Formato').selectOption('image/jpeg')
  await expect(dialog.getByRole('slider', { name: /Qualidade JPEG/ })).toBeVisible()
  const jpeg = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Exportar e baixar' }).click()
  const jpegFile = await jpeg
  expect(jpegFile.suggestedFilename()).toBe('Sala de atendimento.jpg')
  expect(await decodedFile(page, jpegFile)).toEqual({ width: 400, height: 300, alpha: 255 })
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await page.getByRole('button', { name: 'Voltar às montagens' }).click()
  await page.getByRole('button', { name: 'Excluir Sala de atendimento' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir montagem' }).click()
  await expect(page.getByText('Nenhuma montagem por aqui')).toBeVisible()
  expect(errors).toEqual([])
})

test('em 360 px o cache do aplicativo permite recortar com toque e editar offline', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => false, configurable: true })
    })
    await page.goto(baseURL)
    await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible({ timeout: 15000 })
    const background = await imageFile(page, 'background')
    const object = await imageFile(page, 'object')
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
    await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
    await upload(page, background)
    const canvas = await addObject(page, object)
    const photo = await canvas.boundingBox()
    const points = Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8
      return [150 + 82 * Math.cos(angle), 120 + 55 * Math.sin(angle)]
    })
    await touchGesture(page, points.map(([x, y]) => [imagePoint(photo, x, y)]))
    await page.getByRole('button', { name: 'Recortar pelo contorno' }).click()
    await expect(page.getByRole('heading', { name: 'Refine o recorte' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirmar recorte' }).click()
    await expect(page.getByRole('complementary', { name: 'Camadas e ajustes' })).toBeVisible()
    const stage = page.locator('.composition-surface canvas')
    const frame = await stage.boundingBox()
    const x = frame.x + frame.width / 2
    const y = frame.y + frame.height / 2
    const pinch = [[{ x, y }, { x: x + 40, y }], [{ x: x - 12, y: y - 13 }, { x: x + 56, y: y + 27 }]]
    await expect.poll(async () => (await pixelAt(stage, { x, y }))[0]).toBe(223)
    await touchGesture(page, pinch)
    await page.getByRole('button', { name: 'Navegar' }).click()
    await touchGesture(page, pinch)
    await expect(page.getByLabel('Zoom da montagem')).not.toHaveText('100%')
    await page.getByRole('button', { name: 'Mostrar' }).click()
    await expect(page.getByRole('button', { name: 'Almofada', exact: true })).toBeVisible()
    expect(Number(await page.getByRole('slider', { name: 'Escala' }).inputValue())).toBeGreaterThan(55)
    expect(Number(await page.getByRole('slider', { name: 'Rotação' }).inputValue())).toBeGreaterThan(20)
    await page.getByLabel('Aplicar sombra').tap()
    await page.getByText('Ajustar sombras', { exact: true }).tap()
    await setRange(page.getByRole('slider', { name: 'Intensidade da sombra de contato' }), '54')
    await expect(page.getByRole('slider', { name: 'Intensidade da sombra de contato' })).toHaveValue('54')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
    await page.setViewportSize({ width: 700, height: 390 })
    await expect(stage).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await page.getByRole('button', { name: 'Compartilhar montagem' }).click()
    await page.getByRole('button', { name: 'Preparar imagem' }).click()
    await expect(page.getByText(/compartilhamento de arquivos está indisponível/)).toBeVisible()
    const fallback = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar imagem' }).click()
    expect((await fallback).suggestedFilename()).toBe('Montagem sem título.png')
  } finally {
    await context.close()
  }
})

test('MobileSAM separa uma almofada fotografada e reutiliza o modelo offline', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(150_000)
  await page.addInitScript(() => {
    const value = localStorage.getItem('try-webgpu-offline') ? {} : undefined
    Object.defineProperty(navigator, 'gpu', { value })
  })
  const network = []
  const diagnostics = []
  page.on('console', (message) => {
    if (message.text().includes('MobileSAM:')) diagnostics.push(message.text())
  })
  page.on('pageerror', (error) => diagnostics.push(error.message))
  page.on('request', (request) => network.push({ url: request.url(), method: request.method() }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible()
  expect(network.some(({ url }) => url.includes('/ai/'))).toBe(false)
  const background = await imageFile(page, 'background')
  const buffer = await readFile(new URL('../test-fixtures/mobilesam-sala-cc0.jpg', import.meta.url))
  const file = { name: 'Almofada fotografada.jpg', mimeType: 'image/jpeg', buffer }
  const dimensions = [960, 1280]

  async function openPhoto() {
    await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
    await upload(page, background)
    return addObject(page, file, false)
  }

  const canvas = await openPhoto()
  await page.getByRole('button', { name: 'Contorno guia' }).click()
  await drawContour(page, canvas, [[184, 730], [380, 730], [380, 854], [184, 854]], dimensions)
  await page.getByRole('button', { name: 'Manter', exact: true }).click()
  const target = imagePoint(await canvas.boundingBox(), 289, 791, ...dimensions)
  await touchGesture(page, [[target]])
  await page.getByRole('button', { name: 'Remover fundo' }).click()
  await expect.poll(async () => {
    if (diagnostics.length) return diagnostics.at(-1)
    return (await page.getByText(/Recorte por IA ·/).count()) ? 'recorte' : 'aguardando'
  }, { timeout: 85_000 }).toBe('recorte')
  const header = page.locator('.cutout-header')
  await expect(header).toHaveAttribute('data-ai-provider', 'wasm')
  await expect(page.getByText('IA disponível offline', { exact: true })).toBeVisible({ timeout: 10_000 })
  const metrics = await header.evaluate((element) => ({
    load: Number(element.dataset.aiStartupMs), encoding: Number(element.dataset.aiEncodingMs),
    decode: Number(element.dataset.aiDecodingMs),
  }))

  for (const [x, y] of [[267, 742], [304, 843]]) {
    await page.getByRole('button', { name: 'Ver foto', exact: true }).click()
    await page.getByRole('button', { name: 'Remover', exact: true }).click()
    const sample = imagePoint(await canvas.boundingBox(), x, y, ...dimensions)
    await touchGesture(page, [[sample]])
    await expect(page.getByRole('button', { name: 'Ver recorte' })).toHaveCount(0, { timeout: 25_000 })
  }

  await page.getByRole('button', { name: 'Apagar', exact: true }).click()
  await page.getByRole('button', { name: 'Fundo sólido' }).click()
  const rect = await canvas.boundingBox()
  const color = (x, y) => pixelAt(canvas, imagePoint(rect, x, y, ...dimensions))
  await expect.poll(() => color(267, 742)).toEqual([38, 55, 69, 255])
  await expect.poll(() => color(304, 843)).toEqual([38, 55, 69, 255])
  await expect.poll(() => color(289, 791)).not.toEqual([38, 55, 69, 255])
  await testInfo.attach('Prévia real no Chrome', { body: await canvas.screenshot(), contentType: 'image/png' })
  await testInfo.attach('Medição na PWA', { body: JSON.stringify(metrics), contentType: 'application/json' })
  await page.getByRole('button', { name: 'Confirmar recorte' }).click()
  await expect(page.getByRole('button', { name: 'Almofada fotografada', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Salvar montagem' }).click()
  await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()

  await page.evaluate(() => localStorage.setItem('try-webgpu-offline', '1'))
  await context.setOffline(true)
  await page.reload()
  const reopened = await openPhoto()
  const lamp = imagePoint(await reopened.boundingBox(), 278, 285, ...dimensions)
  await page.mouse.click(lamp.x, lamp.y)
  await page.getByRole('button', { name: 'Remover fundo' }).click()
  await expect(page.getByText(/Recorte por IA ·/)).toBeVisible({ timeout: 85_000 })
  await expect(header).toHaveAttribute('data-ai-provider', 'wasm')
  await expect(page.getByText('IA disponível offline', { exact: true })).toBeVisible()
  expect(network.filter(({ url }) => url.startsWith('http')).every(({ url, method }) =>
    url.startsWith(baseURL + '/') && method === 'GET')).toBe(true)
})

test('um toque Manter sem guia seleciona a almofada inteira em tela móvel', async ({ browser, baseURL }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  try {
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
    await upload(page, await imageFile(page, 'background'))
    const canvas = await addObject(page, {
      name: 'Almofada dos três peixes.jpeg', mimeType: 'image/jpeg',
      buffer: await readFile(new URL('../test-fixtures/almofada-peixes.jpeg', import.meta.url)),
    }, false)
    const dimensions = [900, 1600]
    await touchGesture(page, [[imagePoint(await canvas.boundingBox(), 430, 936, ...dimensions)]])
    await page.getByRole('button', { name: 'Remover fundo' }).click()
    await expect(page.getByText(/Recorte por IA ·/)).toBeVisible({ timeout: 85_000 })
    await page.getByRole('button', { name: 'Fundo sólido' }).click()
    await page.getByRole('button', { name: 'Apagar', exact: true }).click()
    const rect = await canvas.boundingBox()
    const matte = [38, 55, 69, 255]
    for (const [x, y] of [[619, 726], [490, 866], [601, 1054], [430, 1220]]) {
      await expect.poll(() => pixelAt(canvas, imagePoint(rect, x, y, ...dimensions))).not.toEqual(matte)
    }
    await expect.poll(() => pixelAt(canvas, imagePoint(rect, 460, 420, ...dimensions))).toEqual(matte)
  } finally {
    await context.close()
  }
})

test('aceitação da almofada dos três peixes preserva o tecido e deixa a palha transparente', async ({ page }, testInfo) => {
  const photo = new URL('../test-fixtures/almofada-peixes.jpeg', import.meta.url)
  test.skip(!existsSync(photo), 'Foto original de aceitação ausente.')
  test.setTimeout(120_000)
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
  await upload(page, await imageFile(page, 'background'))
  const canvas = await addObject(page, {
    name: 'Almofada dos três peixes.jpeg', mimeType: 'image/jpeg', buffer: await readFile(photo),
  }, false)
  const dimensions = [900, 1600]
  await page.getByRole('button', { name: 'Contorno guia' }).click()
  await drawContour(page, canvas, [[4, 523], [850, 523], [850, 1370], [4, 1370]], dimensions)
  await page.getByRole('button', { name: 'Manter', exact: true }).click()
  const center = imagePoint(await canvas.boundingBox(), 430, 936, ...dimensions)
  await page.mouse.click(center.x, center.y)
  await page.getByRole('button', { name: 'Remover fundo' }).click()
  await expect(page.getByText(/Recorte por IA ·/)).toBeVisible({ timeout: 85_000 })
  await page.getByRole('button', { name: 'Fundo sólido' }).click()
  await page.getByRole('button', { name: 'Ver foto', exact: true }).click()
  await page.getByRole('button', { name: 'Remover', exact: true }).click()
  const wicker = imagePoint(await canvas.boundingBox(), 784, 1178, ...dimensions)
  await page.mouse.click(wicker.x, wicker.y)
  await expect(page.getByText('Recorte atualizado.', { exact: true })).toBeVisible({ timeout: 25_000 })
  await page.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect.poll(() => pixelAt(canvas, wicker)).toEqual([38, 55, 69, 255])
  await testInfo.attach('Recorte após um toque Remover', { body: await canvas.screenshot(), contentType: 'image/png' })
  const fish = imagePoint(await canvas.boundingBox(), 601, 1054, ...dimensions)
  await page.getByRole('button', { name: 'Remover', exact: true }).click()
  await page.mouse.click(fish.x, fish.y)
  await expect(page.getByText('Recorte atualizado.', { exact: true })).toBeVisible({ timeout: 25_000 })
  await page.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect.poll(() => pixelAt(canvas, fish)).toEqual([38, 55, 69, 255])
  await page.getByRole('button', { name: 'Manter', exact: true }).click()
  await page.mouse.click(fish.x, fish.y)
  await expect(page.getByText('Recorte atualizado.', { exact: true })).toBeVisible({ timeout: 25_000 })
  await page.mouse.click(fish.x, fish.y)
  await expect(page.getByText(/Já existe uma indicação igual aqui/)).toBeVisible()
  await page.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect.poll(() => pixelAt(canvas, fish)).not.toEqual([38, 55, 69, 255])
  await page.getByRole('button', { name: 'Confirmar recorte' }).click()
  await page.getByRole('button', { name: 'Salvar montagem' }).click()
  await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const request = indexedDB.open('editor-de-ambientes')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const assets = await new Promise((resolve, reject) => {
      const read = db.transaction('media').objectStore('media').getAll()
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => reject(read.error)
    })
    db.close()
    const asset = assets.find(({ mask }) => mask)
    async function readImage(blob) {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return context
    }
    const source = await readImage(asset.blob)
    const cutout = await readImage(asset.cutout)
    const color = (context, x, y) => Array.from(context.getImageData(x, y, 1, 1).data)
    const pixel = (x, y) => color(cutout, x - asset.bounds.x, y - asset.bounds.y)
    const positive = [[619, 726], [490, 866], [601, 1054], [430, 945]]
    const reader = new FileReader()
    const data = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(asset.cutout)
    })
    return {
      type: asset.cutout.type, size: [asset.width, asset.height], data,
      colors: positive.map(([x, y]) => pixel(x, y)), original: positive.map(([x, y]) => color(source, x, y)),
      exterior: [[460, 550], [830, 960], [475, 1320], [26, 840], [784, 1178]].map(([x, y]) => pixel(x, y)[3]),
    }
  })
  expect(result.type).toBe('image/png')
  expect(result.size).toEqual(dimensions)
  expect(result.colors).toEqual(result.original)
  expect(result.exterior).toEqual([0, 0, 0, 0, 0])
  const artifact = testInfo.outputPath('recorte-original.png')
  await writeFile(artifact, Buffer.from(result.data, 'base64'))
  await testInfo.attach('PNG da almofada original', { path: artifact, contentType: 'image/png' })
})

test('corrige EXIF, substitui fundo, recupera o contorno e entrega um arquivo à Web Share API', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: ({ files }) => files[0] instanceof File, configurable: true })
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async ({ files }) => {
        document.documentElement.dataset.share = [files[0].name, files[0].type, navigator.userActivation.isActive].join(',')
      },
    })
  })
  await page.goto('/')
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    return canvas.toDataURL('image/jpeg').split(',')[1]
  })
  const original = Buffer.from(encoded, 'base64')
  const app1 = Buffer.from('ffe100224578696600004d4d002a00000008000101120003000000010006000000000000', 'hex')
  const file = { name: 'Foto orientada.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([original.subarray(0, 2), app1, original.subarray(2)]) }
  await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
  await upload(page, file)
  await expect(page.getByText('300 × 400 px')).toBeVisible()
  await page.getByRole('button', { name: 'Trocar foto de fundo' }).click()
  await upload(page, await imageFile(page, 'background'))
  await expect(page.getByText('400 × 300 px')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Voltar às montagens' })).toBeVisible()
  const canvas = await addObject(page, await imageFile(page, 'uniform'), false)
  await page.context().setOffline(true)
  const center = imagePoint(await canvas.boundingBox(), 150, 120)
  await page.mouse.click(center.x, center.y)
  await page.getByRole('button', { name: 'Remover fundo' }).click()
  await expect(page.getByText(/A IA local não conseguiu gerar o recorte/)).toBeVisible()
  await page.getByRole('button', { name: 'Recorte manual' }).click()
  await drawContour(page, canvas)
  await page.getByRole('button', { name: 'Recortar pelo contorno' }).click()
  await expect(page.getByText(/Recorte manual · Use o pincel/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar recorte' }).click()
  await page.getByRole('button', { name: 'Compartilhar montagem' }).click()
  await page.getByRole('button', { name: 'Preparar imagem' }).click()
  await page.getByRole('button', { name: 'Compartilhar arquivo' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-share', 'Montagem sem título.png,image/png,true')
})

test.describe('contorno em alta densidade de pixels', () => {
  test.use({ deviceScaleFactor: 2 })

  test('preserva uma almofada estampada na resolução nativa ao desenhar com zoom e pan', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
    await upload(page, await imageFile(page, 'background'))
    const canvas = await addObject(page, await imageFile(page, 'fabric'))
    await page.getByLabel('Zoom da fotografia').fill('1.15')
    await page.getByRole('button', { name: 'Mover foto' }).click()
    const rect = await canvas.boundingBox()
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + 34, center.y - 18)
    await page.mouse.up()
    await page.getByRole('button', { name: 'Contorno', exact: true }).click()
    const geometry = [2600, 1000, 1.15, 34, -18]
    const outline = [[350, 205], [870, 119], [1860, 173], [2110, 566], [1760, 815], [1510, 622], [1160, 841], [480, 754]]
    await drawContour(page, canvas, outline, geometry)
    await page.getByRole('button', { name: 'Recortar pelo contorno' }).click()
    await expect(page.getByText(/Recorte manual ·/)).toBeVisible()
    await expect.poll(() => canvas.evaluate((element) => element.width / element.clientWidth)).toBeGreaterThan(1)
    const matte = imagePoint(await canvas.boundingBox(), 500, 105, ...geometry)
    await page.getByRole('button', { name: 'Fundo sólido', exact: true }).click()
    await expect.poll(() => pixelAt(canvas, matte)).toEqual([38, 55, 69, 255])
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click()
    await page.mouse.click(matte.x, matte.y)
    await expect.poll(async () => (await pixelAt(canvas, matte))[0]).toBeGreaterThan(220)
    await page.getByRole('button', { name: 'Desfazer pincelada' }).click()
    await expect.poll(() => pixelAt(canvas, matte)).toEqual([38, 55, 69, 255])
    await page.getByRole('button', { name: 'Fundo sólido', exact: true }).click()
    await expect.poll(() => pixelAt(canvas, matte)).not.toEqual([38, 55, 69, 255])
    await page.getByRole('button', { name: 'Confirmar recorte' }).click()
    await page.getByRole('button', { name: 'Salvar montagem' }).click()
    await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()

    const output = await page.evaluate(async () => {
      const request = indexedDB.open('editor-de-ambientes')
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const assets = await new Promise((resolve, reject) => {
        const request = db.transaction('media').objectStore('media').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      const object = assets.find((asset) => asset.cutout)
      const bitmap = await createImageBitmap(object.cutout)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const point = (x, y) => Array.from(context.getImageData(x - object.bounds.x, y - object.bounds.y, 1, 1).data)
      const boundary = context.getImageData(0, 0, canvas.width, 120).data
      return {
        source: [object.width, object.height],
        png: object.cutout.type,
        fish: point(1120, 480),
        texture: [point(720, 420), point(720, 421)],
        indent: point(1510, 760)[3],
        closed: point(420, 480)[3],
        outside: point(395, 480)[3],
        antialias: boundary.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
      }
    })
    expect(output).toEqual({
      source: [2600, 1000],
      png: 'image/png',
      fish: [22, 69, 119, 255],
      texture: [[247, 243, 232, 255], [233, 229, 220, 255]],
      indent: 0,
      closed: 255,
      outside: 0,
      antialias: true,
    })
  })
})

test('sombras atualizam a prévia, acompanham a rotação e permanecem no PNG e JPEG', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Nova montagem', exact: true }).click()
  await upload(page, await imageFile(page, 'background'))
  const contour = await addObject(page, await imageFile(page, 'object'))
  await drawContour(page, contour)
  await page.getByRole('button', { name: 'Recortar pelo contorno' }).click()
  await page.getByRole('button', { name: 'Confirmar recorte' }).click()
  await expect(page.getByRole('button', { name: 'Almofada', exact: true })).toBeVisible()
  const stage = page.locator('.composition-surface canvas')
  async function stagePixel(x, y) {
    const rect = await stage.boundingBox()
    const scale = Math.min((rect.width - 48) / 400, (rect.height - 56) / 300)
    return pixelAt(stage, {
      x: rect.x + rect.width / 2 + (x - 200) * scale,
      y: rect.y + rect.height / 2 + (y - 150) * scale,
    })
  }
  const red = ([r, g, b]) => r > 165 && g < 120 && b < 120
  const shade = (label) => page.getByRole('slider', { name: label, exact: true })
  await expect.poll(() => stagePixel(264, 203)).toEqual([118, 156, 156, 255])
  await page.getByLabel('Aplicar sombra').check()
  await page.getByText('Ajustar sombras', { exact: true }).click()
  await page.getByRole('button', { name: 'Sombra automática' }).click()
  await expect(shade('Intensidade da sombra de contato')).toHaveValue('32')
  await setRange(shade('Intensidade da sombra de contato'), '0')
  await setRange(shade('Desfoque da sombra ambiente'), '0')
  await setRange(shade('Deslocamento horizontal da sombra'), '14')
  await setRange(shade('Deslocamento vertical da sombra'), '20')
  await page.getByLabel('Cor da sombra').fill('#ff0000')
  await shade('Opacidade da sombra ambiente').evaluate((element) => {
    element.value = 100
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(async () => red(await stagePixel(264, 203))).toBe(true)
  await setRange(shade('Opacidade da sombra ambiente'), '100')
  await setRange(shade('Opacidade da sombra ambiente'), '0')
  await setRange(shade('Intensidade da sombra de contato'), '100')
  await expect.poll(async () => red(await stagePixel(220, 210))).toBe(true)
  await expect.poll(async () => red(await stagePixel(264, 170))).toBe(false)
  await setRange(shade('Rotação'), '90')
  await expect.poll(async () => red(await stagePixel(140, 166))).toBe(true)
  await expect.poll(async () => red(await stagePixel(220, 210))).toBe(false)

  await page.getByRole('button', { name: 'Salvar montagem' }).click()
  await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Abrir montagem Montagem sem título' }).click()
  await page.getByRole('button', { name: 'Almofada', exact: true }).click()
  await expect(page.getByLabel('Aplicar sombra')).toBeChecked()
  await page.getByText('Ajustar sombras', { exact: true }).click()
  await expect(shade('Opacidade da sombra ambiente')).toHaveValue('0')
  await expect(shade('Intensidade da sombra de contato')).toHaveValue('100')
  await expect(shade('Deslocamento horizontal da sombra')).toHaveValue('14')
  await expect(shade('Deslocamento vertical da sombra')).toHaveValue('20')
  await expect(page.getByLabel('Cor da sombra')).toHaveValue('#ff0000')
  await expect.poll(async () => red(await stagePixel(140, 166))).toBe(true)
  await page.getByRole('button', { name: 'Exportar montagem' }).click()
  const dialog = page.getByRole('dialog')
  for (const format of ['image/png', 'image/jpeg']) {
    await dialog.getByLabel('Formato').selectOption(format)
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Exportar e baixar' }).click()
    const result = await decodedFile(page, await download, [[140, 166], [220, 210]])
    expect([result.width, result.height]).toEqual([400, 300])
    expect(red(result.pixels[0])).toBe(true)
    expect(red(result.pixels[1])).toBe(false)
  }
})

async function localRecords(page) {
  return page.evaluate(async () => {
    const result = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const db = await result(indexedDB.open('editor-de-ambientes'))
    try {
      const stores = ['projects', 'assets', 'media', 'cutouts']
      const transaction = db.transaction(stores)
      const [projects, assets, media, cutouts] = await Promise.all(stores.map((name) => result(transaction.objectStore(name).getAll())))
      return { version: db.version, projects, assets, media: media.map(({ id }) => id), cutouts: cutouts.map(({ id, assetId, name }) => ({ id, assetId, name })) }
    } finally {
      db.close()
    }
  })
}

test('abre montagem da versão 1, duplica camadas e sombras e preserva a original ao editar e excluir a cópia offline', async ({ page, context }) => {
  await page.route('**/legacy-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Banco versão 1</title>' }))
  await page.goto('/legacy-fixture')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    const context = canvas.getContext('2d')
    context.fillStyle = '#769c9c'
    context.fillRect(0, 0, 400, 300)
    const background = await new Promise((resolve) => canvas.toBlob(resolve))
    canvas.width = 80
    canvas.height = 60
    context.fillStyle = '#c84c31'
    context.fillRect(0, 0, 80, 60)
    const object = await new Promise((resolve) => canvas.toBlob(resolve))
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('editor-de-ambientes', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        const id = 'montagem-v1'
        db.createObjectStore('summaries', { keyPath: 'id' }).add({
          id, name: 'Sala antiga', updatedAt: Date.now(), thumbnail: background, count: 2,
        })
        const layer = { name: 'Almofada antiga', assetId: 'objeto-v1', x: .5, y: .6, scale: .36, rotation: 23, opacity: .89 }
        db.createObjectStore('projects', { keyPath: 'id' }).add({
          id, name: 'Sala antiga', backgroundId: 'fundo-v1', layers: [
            { ...layer, id: 'camada-1', shadow: true },
            { ...layer, id: 'camada-2', name: 'Segunda almofada', x: .72, shadow: {
              enabled: true, opacity: 31, blur: 3, x: 5, y: 6, color: '#172634', contact: 41,
            } },
          ],
        })
        const assets = db.createObjectStore('assets', { keyPath: ['projectId', 'id'] })
        assets.createIndex('projectId', 'projectId')
        assets.add({ projectId: id, id: 'fundo-v1', blob: background, width: 400, height: 300 })
        assets.add({
          projectId: id, id: 'objeto-v1', name: 'Almofada antiga', blob: object, cutout: object,
          width: 80, height: 60, bounds: { x: 0, y: 0, width: 80, height: 60 },
        })
      }
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Abrir montagem Sala antiga', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Segunda almofada', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Voltar às montagens' }).click()
  const original = (await localRecords(page)).projects[0]
  expect((await localRecords(page)).media).toEqual([])
  await page.getByRole('button', { name: 'Duplicar Sala antiga', exact: true }).click()
  const openingCopy = page.getByRole('button', { name: 'Abrir montagem Sala antiga - Cópia', exact: true })
  await expect(openingCopy).toBeVisible()
  const duplicated = await localRecords(page)
  const copy = duplicated.projects.find(({ id }) => id !== original.id)
  expect(copy).toEqual({ ...original, id: copy.id, name: 'Sala antiga - Cópia' })
  expect(duplicated.media).toHaveLength(2)
  expect(duplicated.assets).toHaveLength(4)
  await page.reload()
  await page.getByRole('button', { name: 'Renomear Sala antiga - Cópia', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Nome da montagem').fill('Sala alternativa')
  await page.getByRole('button', { name: 'Salvar nome' }).click()
  await page.getByRole('button', { name: 'Abrir montagem Sala alternativa' }).click()
  await page.getByRole('button', { name: 'Segunda almofada' }).click()
  await expect(page.getByRole('slider', { name: 'Rotação' })).toHaveValue('23')
  await setRange(page.getByRole('slider', { name: 'Rotação' }), '80')
  await page.getByText('Ajustar sombras', { exact: true }).click()
  await setRange(page.getByRole('slider', { name: 'Intensidade da sombra de contato' }), '73')
  await page.getByRole('button', { name: 'Salvar montagem' }).click()
  await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()
  const edited = (await localRecords(page)).projects
  expect(edited.find(({ id }) => id === original.id)).toEqual(original)
  expect(edited.find(({ id }) => id === copy.id).layers[1]).toMatchObject({ rotation: 80, shadow: { contact: 73 } })
  await page.getByRole('button', { name: 'Voltar às montagens' }).click()
  await page.getByRole('button', { name: 'Excluir Sala alternativa' }).click()
  await page.getByRole('button', { name: 'Excluir montagem', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Abrir montagem Sala alternativa' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Abrir montagem Sala antiga', exact: true }).click()
  const surviving = await localRecords(page)
  expect(surviving.projects).toEqual([original])
  expect(surviving.media).toHaveLength(2)
  await expect(page.getByRole('button', { name: 'Segunda almofada' })).toBeVisible()
})

test('Meus Recortes conserva transparência e reutiliza instâncias offline a 360 px, inclusive após excluir da biblioteca', async ({ browser, baseURL }) => {
  test.setTimeout(90_000)
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    await page.goto(baseURL)
    await expect(page.getByRole('button', { name: 'Offline pronto' })).toBeVisible({ timeout: 15_000 })
    const background = await imageFile(page, 'background')
    const object = await imageFile(page, 'object')
    await context.setOffline(true)
    const noModel = []
    page.on('request', (request) => { if (request.url().includes('/ai/')) noModel.push(request.url()) })
    await page.reload()
    await page.getByRole('button', { name: 'Meus Recortes', exact: true }).tap()
    await expect(page.getByText('Nenhum recorte salvo', { exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).tap()

    async function start(name) {
      await page.getByRole('button', { name: 'Nova montagem', exact: true }).tap()
      await upload(page, background)
      await page.getByLabel('Nome da montagem').fill(name)
    }
    async function saveAndExit() {
      await page.getByRole('button', { name: 'Salvar montagem' }).tap()
      await expect(page.getByText('Salva no dispositivo', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Voltar às montagens' }).tap()
    }
    async function pickFromLibrary() {
      await page.locator('.editor-toolbar').getByRole('button', { name: 'Adicionar objeto', exact: true }).tap()
      await page.getByRole('dialog').getByRole('button', { name: 'Meus Recortes', exact: true }).tap()
      await page.getByRole('button', { name: 'Adicionar Peça renomeada à montagem', exact: true }).tap()
    }

    await start('Sala A')
    const canvas = await addObject(page, object)
    const contour = Array.from({ length: 19 }, (_, index) => {
      const angle = index * Math.PI / 9
      return [150 + 72 * Math.cos(angle), 120 + 45 * Math.sin(angle)]
    })
    await drawContour(page, canvas, contour)
    await page.getByRole('button', { name: 'Recortar pelo contorno' }).tap()
    await expect(page.getByRole('heading', { name: 'Refine o recorte' })).toBeVisible()
    await page.getByRole('button', { name: 'Salvar em Meus Recortes', exact: true }).tap()
    await page.getByLabel('Nome do recorte').fill('Peça recortada')
    await page.getByRole('button', { name: 'Salvar recorte', exact: true }).tap()
    await expect(page.getByText('Objeto salvo em Meus Recortes.')).toBeVisible()
    await saveAndExit()
    await page.reload()
    await page.getByRole('button', { name: 'Meus Recortes', exact: true }).tap()
    await page.getByRole('button', { name: 'Visualizar Peça recortada' }).tap()
    const picture = page.getByRole('img', { name: 'Peça recortada' })
    await expect(picture).toBeVisible()
    const cutout = await picture.evaluate(async (image) => {
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { size: [canvas.width, canvas.height], exterior: context.getImageData(0, 0, 1, 1).data[3],
        interior: context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3] }
    })
    expect(cutout).toMatchObject({ exterior: 0, interior: 255 })
    expect(cutout.size[0]).toBeGreaterThanOrEqual(143)
    expect(cutout.size[0]).toBeLessThanOrEqual(146)
    expect(cutout.size[1]).toBeGreaterThanOrEqual(88)
    expect(cutout.size[1]).toBeLessThanOrEqual(92)
    await page.getByRole('button', { name: 'Voltar aos recortes' }).tap()
    await page.getByRole('button', { name: 'Renomear Peça recortada' }).tap()
    const naming = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Renomear recorte' }) })
    await naming.getByLabel('Nome do recorte').fill('Peça renomeada')
    await naming.getByRole('button', { name: 'Salvar nome' }).tap()
    await expect(page.getByRole('button', { name: 'Visualizar Peça renomeada' })).toBeVisible()
    const library = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Meus Recortes', exact: true }) })
    expect(await library.evaluate((panel) => panel.scrollWidth)).toBeLessThanOrEqual(360)
    await library.getByRole('button', { name: 'Fechar' }).tap()

    await page.getByRole('button', { name: 'Abrir montagem Sala A' }).tap()
    await pickFromLibrary()
    await pickFromLibrary()
    await page.getByRole('button', { name: 'Mostrar', exact: true }).tap()
    await setRange(page.getByRole('slider', { name: 'Rotação' }), '37')
    await page.getByLabel('Posição X').fill('72')
    await page.getByLabel('Posição X').blur()
    await saveAndExit()
    await start('Sala B')
    await pickFromLibrary()
    await saveAndExit()
    const before = await localRecords(page)
    const first = before.projects.find(({ name }) => name === 'Sala A')
    const second = before.projects.find(({ name }) => name === 'Sala B')
    const [entry] = before.cutouts
    expect(first.layers.map(({ assetId }) => assetId)).toEqual([entry.assetId, entry.assetId, entry.assetId])
    expect(new Set(first.layers.map(({ id }) => id)).size).toBe(3)
    expect(first.layers.map(({ name, rotation, x }) => [name, rotation, x])).toEqual([
      ['Almofada', 0, .5], ['Peça renomeada', 0, .5], ['Peça renomeada', 37, .72],
    ])
    expect(second.layers[0]).toMatchObject({ assetId: entry.assetId, rotation: 0 })
    expect(before.media).toHaveLength(3)

    await page.getByRole('button', { name: 'Meus Recortes', exact: true }).tap()
    await page.getByRole('button', { name: 'Excluir Peça renomeada' }).tap()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Visualizar Peça renomeada' })).toBeVisible()
    await page.getByRole('button', { name: 'Excluir Peça renomeada' }).tap()
    await page.getByRole('button', { name: 'Excluir recorte', exact: true }).tap()
    await expect(page.getByText('Nenhum recorte salvo', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: 'Fechar' }).tap()
    expect((await localRecords(page)).media).toContain(entry.assetId)
    await page.getByRole('button', { name: 'Abrir montagem Sala A' }).tap()
    await expect(page.locator('.layer-row')).toHaveCount(3)
    await page.getByRole('button', { name: 'Voltar às montagens' }).tap()
    await page.getByRole('button', { name: 'Abrir montagem Sala B' }).tap()
    await page.getByRole('button', { name: 'Exportar montagem' }).tap()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Formato').selectOption('image/png')
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Exportar e baixar' }).tap()
    expect(await decodedFile(page, await download, [[200, 150], [5, 5]])).toEqual({
      width: 400, height: 300, alpha: 0, pixels: [[223, 103, 75, 255], [0, 0, 0, 0]],
    })
    await dialog.getByLabel('Formato').selectOption('image/jpeg')
    const jpeg = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Exportar e baixar' }).tap()
    const exported = await decodedFile(page, await jpeg, [[200, 150]])
    expect(exported).toMatchObject({ width: 400, height: 300, alpha: 255 })
    expect(exported.pixels[0][0]).toBeGreaterThan(200)
    expect(noModel).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
    await dialog.getByRole('button', { name: 'Fechar' }).tap()
    await page.getByRole('button', { name: 'Voltar às montagens' }).tap()
    for (const name of ['Sala A', 'Sala B']) {
      await page.getByRole('button', { name: 'Excluir ' + name, exact: true }).tap()
      await page.getByRole('button', { name: 'Excluir montagem', exact: true }).tap()
      await expect(page.getByRole('button', { name: 'Abrir montagem ' + name })).toHaveCount(0)
    }
    expect((await localRecords(page)).media).toEqual([])
  } finally {
    await context.close()
  }
})
