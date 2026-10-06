import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { artifactFiles, hashArtifactFile, isPackageTarget, packageBinaries, readArtifactManifest, validateFileRecords, validatePackageManifest, verifyArtifactFiles, verifyExecutableFiles, type ArtifactFile, type PackageTarget } from './verify-package'

export function bundleLayout(target: PackageTarget) {
  const mac = target === 'macos-arm64'
  return {
    application: mac ? 'Jazzkeys.app' : 'jazzkeys',
    binaries: mac ? 'Jazzkeys.app/Contents/MacOS' : 'jazzkeys/bin',
    resources: mac ? 'Jazzkeys.app/Contents/Resources' : 'jazzkeys/share',
    layout: mac ? 'macOS app bundle' : 'unprivileged relocatable directory',
    signing: mac ? 'no Developer ID or notarization' : 'unsigned ELF files',
  }
}
export interface BundleManifest {
  schemaVersion: 1; product: 'Jazzkeys'; version: string; target: PackageTarget
  sourceCommit: string; sourceTree: string; hardwareStatus: 'no_hardware_demo'; redistributionStatus: 'source_companion_required'
  protocolVersion: 1; appearanceProtocolVersion: 1; signing: string; layout: string; application: string
  sourceManifest: string; sourceManifestSha256: string
  executableSha256: string; workerSha256: string; appearanceHelperSha256: string
  files: ArtifactFile[]
}
export async function bundleFileRecords(directory: string): Promise<ArtifactFile[]> {
  return Promise.all((await artifactFiles(directory, 'bundle-manifest.json')).map(async name => ({
    name, bytes: (await lstat(join(directory, name))).size, sha256: await hashArtifactFile(join(directory, name)),
  })))
}
/** Read-only, no executable loading. Hashes establish self-consistency, not publisher identity. */
export async function verifyBundle(directory: string): Promise<BundleManifest> {
  const value = await readArtifactManifest(directory, 'bundle-manifest.json')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unknown bundle manifest')
  const manifest = value as BundleManifest
  if (manifest.schemaVersion !== 1 || manifest.product !== 'Jazzkeys' || !isPackageTarget(manifest.target) ||
      manifest.hardwareStatus !== 'no_hardware_demo' || manifest.redistributionStatus !== 'source_companion_required' ||
      manifest.protocolVersion !== 1 || manifest.appearanceProtocolVersion !== 1) throw new Error('Unknown bundle manifest or protocol')
  const layout = bundleLayout(manifest.target)
  const sourcePath = `${layout.resources}/source-manifest.json`
  if (manifest.application !== layout.application || manifest.layout !== layout.layout || manifest.signing !== layout.signing ||
      manifest.sourceManifest !== sourcePath) throw new Error('Unexpected bundle layout or source manifest path')
  const required = [`${layout.resources}/INSTALL.txt`, sourcePath,
    ...(manifest.target === 'macos-arm64' ? ['Jazzkeys.app/Contents/Info.plist'] : [])]
  // Reject traversal before any path taken from the manifest is opened.
  const files = validateFileRecords(manifest.files, name => name.startsWith(`${layout.application}/`), required)
  await verifyArtifactFiles(directory, files, 'bundle-manifest.json')
  const sourceRecord = files.find(file => file.name === sourcePath)!
  if (manifest.sourceManifestSha256 !== sourceRecord.sha256) throw new Error('Source manifest hash metadata mismatch')
  const source = validatePackageManifest(await readArtifactManifest(directory, sourcePath))
  if (source.product !== manifest.product || source.target !== manifest.target || source.version !== manifest.version ||
      source.sourceCommit !== manifest.sourceCommit || source.sourceTree !== manifest.sourceTree ||
      source.protocolVersion !== manifest.protocolVersion || source.appearanceProtocolVersion !== manifest.appearanceProtocolVersion) throw new Error('Bundle source provenance or protocol mismatch')
  const expected = new Set(required)
  for (const file of source.files) {
    const binary = packageBinaries.includes(file.name as typeof packageBinaries[number])
    const name = `${binary ? layout.binaries : layout.resources}/${file.name}`
    expected.add(name)
    const installed = files.find(record => record.name === name)
    if (!installed || installed.sha256 !== file.sha256 || installed.bytes !== file.bytes) throw new Error(`Bundle differs from source package: ${file.name}`)
  }
  if (expected.size !== files.length || files.some(file => !expected.has(file.name))) throw new Error('Unlisted bundle contents outside source package')
  for (const [name, digest] of [
    ['jazzkeys', manifest.executableSha256], ['jazzkeys-device', manifest.workerSha256], ['jazzkeys-appearance', manifest.appearanceHelperSha256],
  ]) {
    if (source.files.find(file => file.name === name)!.sha256 !== digest) throw new Error(`Bundle binary hash metadata mismatch: ${name}`)
  }
  await verifyExecutableFiles(directory, packageBinaries.map(name => `${layout.binaries}/${name}`))
  return manifest
}
if (import.meta.main) {
  const manifest = await verifyBundle(resolve(process.argv[2] ?? 'dist/install/linux-x64-gnu'))
  console.log(JSON.stringify({verifiedBundle: true, target: manifest.target, hardwareStatus: manifest.hardwareStatus, verificationScope: 'self-consistency, not signed authenticity'}))
}
