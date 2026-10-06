import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export type PackageTarget = 'macos-arm64' | 'linux-x64-gnu'
export interface ArtifactFile { name: string; bytes: number; sha256: string }
export interface PackageManifest {
  schemaVersion: 1; product: 'Jazzkeys'; version: string; target: PackageTarget
  sourceCommit: string; sourceTree: string; hardwareStatus: 'no_hardware_demo'; signing: 'unsigned'
  bun: string; gpuix: string; workerVersion: string; protocolVersion: 1
  appearanceProtocolVersion: 1; appearanceHelperSha256: string; embeddedNativeAddonSha256: string
  files: ArtifactFile[]
}
export const packageBinaries = ['jazzkeys', 'jazzkeys-device', 'jazzkeys-appearance'] as const
// This is the already-retained baseline, not a declaration of license completeness.
// Additional docs are included and hash-checked through the source manifest.
export const requiredPackageFiles: readonly string[] = [
  'LICENSE', 'THIRD-PARTY-NOTICES.md', ...packageBinaries,
  'docs/INSTALL.md', 'docs/SAFETY.md', 'docs/HARDWARE.md', 'docs/PROTOCOL.md', 'docs/RELEASE.md', 'docs/VERIFICATION.md',
  ...['README.md', 'Bun-LICENSE.md', 'CSSType-MIT.txt', 'DefinitelyTyped-MIT.txt',
    'GPUI-Apache-2.0.txt', 'GPUIX-Apache-2.0.txt', 'GPUIX-THIRD-PARTY-NOTICES.md',
    'IBM-Plex-Sans-OFL.txt', 'Lilex-OFL.txt', 'React-MIT.txt', 'TypeScript-Apache-2.0.txt',
    'TypeScript-THIRD-PARTY-NOTICES.txt', 'Undici-MIT.txt', 'Zod-MIT.txt', 'eventsource-parser-MIT.txt']
    .map(name => `docs/licenses/${name}`),
]
const sha256 = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value)
const commit = (value: unknown): value is string => typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && !/\s/.test(value) && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
export function isPackageTarget(value: unknown): value is PackageTarget { return value === 'macos-arm64' || value === 'linux-x64-gnu' }
export function isRelativeArtifactPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !/[\\\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
export function validateFileRecords(value: unknown, allowed: (name: string) => boolean, required: readonly string[]): ArtifactFile[] {
  if (!Array.isArray(value) || value.length > 10_000 || value.some(file => !file || typeof file !== 'object' ||
      !isRelativeArtifactPath(file.name) || !allowed(file.name))) throw new Error('Unexpected package contents')
  const files = value as ArtifactFile[]
  const names = files.map(file => file.name)
  if (new Set(names).size !== names.length || required.some(name => !names.includes(name))) throw new Error('Unexpected package contents: required file missing or duplicate')
  if (files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !sha256(file.sha256) ||
      (required.includes(file.name) && file.bytes === 0))) throw new Error('Invalid package file record')
  return files
}
export function validatePackageManifest(value: unknown): PackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unknown package manifest')
  const manifest = value as Record<string, unknown>
  if (manifest.schemaVersion !== 1 || manifest.product !== 'Jazzkeys' || manifest.hardwareStatus !== 'no_hardware_demo' ||
      manifest.signing !== 'unsigned' || !isPackageTarget(manifest.target) || !version(manifest.version) ||
      !commit(manifest.sourceCommit) || !commit(manifest.sourceTree) || !version(manifest.bun) ||
      !version(manifest.gpuix) || !version(manifest.workerVersion) || manifest.protocolVersion !== 1 ||
      manifest.appearanceProtocolVersion !== 1 || !sha256(manifest.appearanceHelperSha256) ||
      !sha256(manifest.embeddedNativeAddonSha256)) throw new Error('Unknown package manifest or invalid source/protocol metadata')
  const files = validateFileRecords(manifest.files, name => requiredPackageFiles.includes(name) || name.startsWith('docs/'), requiredPackageFiles)
  if (files.find(file => file.name === 'jazzkeys-appearance')!.sha256 !== manifest.appearanceHelperSha256) throw new Error('Appearance helper hash metadata mismatch')
  return manifest as unknown as PackageManifest
}
export async function readArtifactManifest(directory: string, name: string): Promise<unknown> {
  const info = await lstat(join(directory, name))
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o6022) || info.size > 2_000_000) throw new Error('Unsafe package manifest')
  return JSON.parse(await readFile(join(directory, name), 'utf8'))
}
export async function artifactFiles(directory: string, excludedManifest: string): Promise<string[]> {
  const files: string[] = []
  let entries = 0
  async function walk(relative: string, depth: number) {
    if (depth > 12) throw new Error('Package nesting exceeds limit')
    const directoryInfo = await lstat(join(directory, relative))
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o6022)) throw new Error('Unsafe package directory mode or symlink')
    for (const entry of await readdir(join(directory, relative))) {
      if (++entries > 10_000) throw new Error('Package file count exceeds limit')
      const name = relative ? `${relative}/${entry}` : entry
      if (name === excludedManifest) continue
      const info = await lstat(join(directory, name))
      if (info.isSymbolicLink() || (info.mode & 0o6022)) throw new Error('Unsafe package file mode or symlink')
      if (info.isDirectory()) await walk(name, depth + 1)
      else if (info.isFile()) files.push(name)
      else throw new Error('Unsupported package file type')
    }
  }
  await walk('', 0)
  return files.sort()
}
export const packageFiles = (directory: string) => artifactFiles(directory, 'manifest.json')
export async function hashArtifactFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function verifyArtifactFiles(directory: string, files: ArtifactFile[], manifestName: string): Promise<void> {
  const names = files.map(file => file.name).sort()
  const actual = await artifactFiles(directory, manifestName)
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Unlisted package contents or missing file')
  for (const file of files) {
    const path = join(directory, file.name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o6022)) throw new Error('Unsafe package file')
    if (info.size !== file.bytes || await hashArtifactFile(path) !== file.sha256) throw new Error(`Hash mismatch: ${file.name}`)
  }
}
export async function verifyExecutableFiles(directory: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    if (!((await lstat(join(directory, name))).mode & 0o111)) throw new Error(`Package binary is not executable: ${name}`)
  }
}
/** Establishes artifact self-consistency only, not signed authenticity or license clearance. */
export async function verifyPackage(directory: string): Promise<PackageManifest> {
  const manifest = validatePackageManifest(await readArtifactManifest(directory, 'manifest.json'))
  await verifyArtifactFiles(directory, manifest.files, 'manifest.json')
  await verifyExecutableFiles(directory, packageBinaries)
  return manifest
}
if (import.meta.main) {
  const manifest = await verifyPackage(resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu'))
  console.log(JSON.stringify({verifiedPackage: true, target: manifest.target, hardwareStatus: manifest.hardwareStatus, verificationScope: 'self-consistency, not signed authenticity'}))
}
