import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export async function verifyPackage(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.hardwareStatus !== 'no_hardware_demo') throw new Error('Unknown package manifest')
  const expected = ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'jazzkeys', 'jazzkeys-device']
  if (JSON.stringify(manifest.files.map((f: {name: string}) => f.name).sort()) !== JSON.stringify(expected.sort())) throw new Error('Unexpected package contents')
  const actual = (await readdir(directory)).filter(name => name !== 'manifest.json').sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) throw new Error('Unlisted package contents')
  for (const file of manifest.files) {
    const path = join(directory, file.name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o002)) throw new Error('Unsafe package file')
    const bytes = await readFile(path)
    if (bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Hash mismatch: ${file.name}`)
  }
  return manifest
}
if (import.meta.main) {
  const manifest = await verifyPackage(resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu'))
  console.log(JSON.stringify({verifiedPackage: true, target: manifest.target, hardwareStatus: manifest.hardwareStatus}))
}
