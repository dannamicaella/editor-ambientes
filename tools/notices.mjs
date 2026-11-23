import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeNotices(outDir) {
  const { packages } = JSON.parse(await readFile('package-lock.json', 'utf8'))
  const sections = [
    'Editor de Ambientes — avisos de terceiros',
    'Fotografia da tela inicial: Stephen Di Donato, Furnished living room (2016), CC0 1.0.\n'
      + 'https://commons.wikimedia.org/wiki/File:Furnished_living_room._(Unsplash).jpg\n'
      + 'https://creativecommons.org/publicdomain/zero/1.0/',
  ]
  for (const [path, metadata] of Object.entries(packages)) {
    if (!path || metadata.dev) continue
    const name = path.split('node_modules/').at(-1)
    const files = (await readdir(path)).filter((file) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(file))
    let sources = files.map((file) => join(path, file))
    if (!sources.length && name === 'guid-typescript' && metadata.version === '1.0.9') {
      sources = ['tools/licenses/guid-typescript-1.0.9-ISC.txt']
    }
    if (!sources.length && ['onnxruntime-common', 'onnxruntime-web'].includes(name) && metadata.version === '1.24.3') {
      sources = ['tools/licenses/onnxruntime-1.24.3-LICENSE.txt']
      if (name === 'onnxruntime-web') sources.push('tools/licenses/onnxruntime-1.24.3-ThirdPartyNotices.txt')
    }
    if (!sources.length) throw new Error('Aviso de licença ausente em ' + path)
    const notices = await Promise.all(sources.map((file) => readFile(file, 'utf8')))
    sections.push(name + ' ' + metadata.version + '\n\n' + notices.join('\n\n').trim())
  }
  await writeFile(join(outDir, 'THIRD-PARTY-NOTICES.txt'), sections.join('\n\n' + '─'.repeat(70) + '\n\n') + '\n')
}
