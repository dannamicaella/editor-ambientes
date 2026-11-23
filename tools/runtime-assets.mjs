import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'

const root = 'node_modules/onnxruntime-web'
const dist = join(root, 'dist')

export async function runtimeAssets() {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const directory = 'ort-' + version
  const files = new Map()
  const profiles = {}
  for (const provider of ['wasm', 'webgpu']) {
    const name = 'ort-wasm-simd-threaded' + (provider === 'webgpu' ? '.jsep' : '')
    const profile = {}
    for (const [kind, file] of Object.entries({
      module: provider === 'webgpu' ? 'ort.all.min.mjs' : 'ort.wasm.min.mjs',
      glue: name + '.mjs', binary: name + '.wasm',
    })) {
      const source = join(dist, file)
      const path = directory + '/' + file
      profile[kind] = { path, bytes: (await stat(source)).size }
      files.set(path, source)
    }
    profiles[provider] = profile
  }
  return { manifest: JSON.stringify({ version, profiles }), files, directory }
}

export function onnxRuntimeAssets(outDir) {
  return {
    name: 'editor-onnx-runtime',
    async configureServer(server) {
      const { manifest, files } = await runtimeAssets()
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url, 'http://localhost').pathname
        if (path === '/ai/runtime.json') {
          response.setHeader('Content-Type', 'application/json')
          return response.end(manifest)
        }
        const file = files.get(path.slice('/ai/'.length))
        if (!path.startsWith('/ai/') || !file) return next()
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        createReadStream(file).pipe(response)
      })
    },
    async writeBundle() {
      const { manifest, files, directory } = await runtimeAssets()
      const output = join(outDir, 'ai')
      await mkdir(join(output, directory), { recursive: true })
      await Promise.all([...files].map(([file, source]) => copyFile(source, join(output, file))))
      await writeFile(join(output, 'runtime.json'), manifest)
    },
  }
}
