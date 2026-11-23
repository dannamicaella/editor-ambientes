import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeNotices } from './tools/notices.mjs'
import { onnxRuntimeAssets } from './tools/runtime-assets.mjs'

function offlineBuild(enabled, outDir) {
  return {
    name: 'editor-offline',
    transformIndexHtml() {
      if (!enabled) return []
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icons/icon-192.png' } },
      ]
    },
    async closeBundle() {
      await writeNotices(outDir)
      if (!enabled) return
      const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
      const files = entries.filter((entry) => entry.isFile() && entry.name !== 'sw.js')
        .map((entry) => join(entry.parentPath, entry.name).slice(outDir.length + 1).replaceAll('\\', '/'))
        .sort()
      const shell = files.filter((file) => !file.startsWith('ai/'))
      const optional = files.filter((file) => file.startsWith('ai/'))
      const hash = createHash('sha256')
      for (const file of shell) hash.update(file).update(await readFile(join(outDir, file)))
      const aiHash = createHash('sha256')
      for (const file of optional.filter((path) => path.endsWith('.json'))) {
        aiHash.update(file).update(await readFile(join(outDir, file)))
      }
      const worker = await readFile('tools/sw-template.js', 'utf8')
      const ai = aiHash.digest('hex').slice(0, 16)
      hash.update(worker).update(ai)
      await writeFile(join(outDir, 'sw.js'), worker
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 16)))
        .replace("'__AI_VERSION__'", JSON.stringify(ai))
        .replace("['__FILES__']", JSON.stringify(shell))
        .replace("['__AI_FILES__']", JSON.stringify(optional)))
    },
  }
}

export default defineConfig(({mode}) => {
  const pwa = mode === 'pwa'
  const outDir = pwa ? 'dist-pwa' : 'dist'
  return {
    base: './',
    plugins: [vue(), onnxRuntimeAssets(outDir), offlineBuild(pwa, outDir)],
    optimizeDeps: { entries: ['index.html'] },
    define: { __PWA__: JSON.stringify(pwa) },
    build: { outDir, assetsInlineLimit: 0 },
  }
})
