import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export async function packageFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  async function walk(relative: string, depth: number) {
    if (depth > 12) throw new Error('Package nesting exceeds limit')
    for (const entry of await readdir(join(directory,relative))) {
      const name = relative ? `${relative}/${entry}` : entry
      if (name === 'manifest.json') continue
      const info = await lstat(join(directory,name))
      if (info.isSymbolicLink() || (info.mode & 0o6022)) throw new Error('Unsafe package file mode or symlink')
      if (info.isDirectory()) await walk(name,depth+1)
      else if (info.isFile()) files.push(name)
      else throw new Error('Unsupported package file type')
      if (files.length > 10_000) throw new Error('Package file count exceeds limit')
    }
  }
  await walk('',0)
  return files.sort()
}
export async function verifyPackage(directory: string) {
  const manifestPath = join(directory,'manifest.json')
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) throw new Error('Unsafe package manifest')
  const manifest = JSON.parse(await readFile(manifestPath,'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.hardwareStatus !== 'no_hardware_demo') throw new Error('Unknown package manifest')
  const required = ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'jazzkeys', 'jazzkeys-device']
  if (manifest.appearanceProtocolVersion === 1) required.push('jazzkeys-appearance')
  const allowed = (name: unknown): name is string => typeof name === 'string' &&
    !name.includes('\\') && name.split('/').every(part=>part !== '' && part !== '.' && part !== '..') &&
    (required.includes(name) || name.startsWith('docs/'))
  if (!Array.isArray(manifest.files) || manifest.files.length > 10_000 || manifest.files.some((f: {name?:unknown})=>!allowed(f?.name))) throw new Error('Unexpected package contents')
  const names: string[] = manifest.files.map((f: {name:string})=>f.name).sort()
  if (new Set(names).size !== names.length || required.some(name=>!names.includes(name))) throw new Error('Unexpected package contents')
  const actual = await packageFiles(directory)
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Unlisted package contents')
  for (const file of manifest.files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid package file record')
    const path = join(directory, file.name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o6022)) throw new Error('Unsafe package file')
    const bytes = await readFile(path)
    if (bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Hash mismatch: ${file.name}`)
  }
  return manifest
}
if (import.meta.main) {
  const manifest = await verifyPackage(resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu'))
  console.log(JSON.stringify({verifiedPackage: true, target: manifest.target, hardwareStatus: manifest.hardwareStatus}))
}
