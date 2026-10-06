/** Offline text fixtures only. No real binaries are loaded or executed. */
import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { packageBinaries, requiredPackageFiles, type PackageManifest, type PackageTarget } from './verify-package'
import { bundleFileRecords, bundleLayout, type BundleManifest } from './verify-bundle'

export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export async function packageFixture(target: PackageTarget = 'linux-x64-gnu') {
  const dir = await mkdtemp(join(tmpdir(), 'jazzkeys-package-test-'))
  const contents = Object.fromEntries([...requiredPackageFiles, 'docs/extra-retained-notice.txt'].map(name => [name, `offline fixture: ${name}\n`]))
  for (const [name, body] of Object.entries(contents)) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), body)
    if (packageBinaries.includes(name as typeof packageBinaries[number])) await chmod(join(dir, name), 0o755)
  }
  const manifest: PackageManifest = {
    schemaVersion: 1, product: 'Jazzkeys', version: '0.1.0-dev.0', target,
    sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), hardwareStatus: 'no_hardware_demo', signing: 'unsigned',
    bun: '1.3.10', gpuix: '0.10.0', workerVersion: '0.1.0', protocolVersion: 1, appearanceProtocolVersion: 1,
    appearanceHelperSha256: digest(contents['jazzkeys-appearance']!), embeddedNativeAddonSha256: 'e'.repeat(64),
    files: Object.entries(contents).map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: digest(body) })),
  }
  const save = () => writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  await save()
  return { dir, contents, manifest, save }
}
export async function bundleFixture(target: PackageTarget) {
  const flat = await packageFixture(target)
  const dir = await mkdtemp(join(tmpdir(), 'jazzkeys-bundle-test-'))
  const layout = bundleLayout(target)
  for (const file of flat.manifest.files) {
    const binary = packageBinaries.includes(file.name as typeof packageBinaries[number])
    const to = join(dir, binary ? layout.binaries : layout.resources, file.name)
    await mkdir(dirname(to), { recursive: true })
    await cp(join(flat.dir, file.name), to)
  }
  const sourceManifest = `${layout.resources}/source-manifest.json`
  await cp(join(flat.dir, 'manifest.json'), join(dir, sourceManifest))
  await writeFile(join(dir, layout.resources, 'INSTALL.txt'), 'Offline installation instructions fixture\n')
  if (target === 'macos-arm64') await writeFile(join(dir, layout.application, 'Contents/Info.plist'), 'Offline plist fixture\n')
  const manifest: BundleManifest = {
    schemaVersion: 1, product: 'Jazzkeys', version: flat.manifest.version, target,
    sourceCommit: flat.manifest.sourceCommit, sourceTree: flat.manifest.sourceTree,
    protocolVersion: 1, appearanceProtocolVersion: 1, hardwareStatus: 'no_hardware_demo', redistributionStatus: 'source_companion_required',
    layout: layout.layout, signing: layout.signing, application: layout.application,
    sourceManifest, sourceManifestSha256: digest(await readFile(join(dir, sourceManifest), 'utf8')),
    executableSha256: digest(flat.contents.jazzkeys!), workerSha256: digest(flat.contents['jazzkeys-device']!),
    appearanceHelperSha256: flat.manifest.appearanceHelperSha256, files: await bundleFileRecords(dir),
  }
  const save = () => writeFile(join(dir, 'bundle-manifest.json'), JSON.stringify(manifest))
  await save()
  return { dir, flat, layout, manifest, save }
}
