import { copyFile, mkdir, readFile, lstat, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { packageFiles, verifyPackage } from './verify-package'
import { buildAppearanceHelper } from '../appearance/build'
import { copyCommittedDocs } from './committed-docs'
import { inspectMacCode, signMacCode, requireValidMacCode } from './sign-macos'

// Host-platform builds with credential-free Mac development signatures. No installer or device access.
if (Bun.version !== '1.3.10') throw new Error('Build requires Bun 1.3.10')
const target = process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64'
  : process.platform === 'linux' && process.arch === 'x64' ? 'linux-x64-gnu' : null
if (!target) throw new Error('Only macOS ARM64 and Linux x86-64 GNU are initial targets')
const root = resolve(import.meta.dir, '..')
const status = Bun.spawnSync(['git','status','--porcelain'],{cwd:root})
if (status.exitCode !== 0 || status.stdout.toString().trim()) throw new Error('Commit the reviewed source before packaging; dirty builds cannot claim commit provenance')
const commit = Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:root}).stdout.toString().trim()
const sourceTree = Bun.spawnSync(['git','rev-parse','HEAD^{tree}'],{cwd:root}).stdout.toString().trim()
if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(sourceTree)) throw new Error('Cannot establish source provenance')
const out = join(root, 'dist', `jazzkeys-${target}`)
let previous: Awaited<ReturnType<typeof lstat>> | undefined
try { previous = await lstat(out) } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (previous) {
  if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Unsafe previous package destination')
  await verifyPackage(out)
  await rm(out,{recursive:true})
}
await mkdir(out, { recursive: true, mode: 0o755 })
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Build failed: ${args[0]}`)
}
await run(['cargo', 'build', '--manifest-path', 'device/Cargo.toml', '--locked', '--release'])
const worker = join(out, 'jazzkeys-device')
await copyFile(join(root, 'device/target/release/jazzkeys-device'), worker)
if (process.platform === 'darwin') {
  await signMacCode(worker, 'io.jazzkeys.desktop.device')
  requireValidMacCode(worker)
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const workerHash = sha256(await readFile(worker))
await buildAppearanceHelper(join(out,'jazzkeys-appearance'))
const appearanceHash = sha256(await readFile(join(out,'jazzkeys-appearance')))
// The stock napi-rs loader uses createRequire, which Bun cannot discover as a
// static native dependency. Embed the exact addon through Bun's public file
// loader and set the stock loader override before importing any GPUIX module.
const nativeTarget = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64-gnu'
const addon = `node_modules/@gpuix/native-${nativeTarget}/gpuix-native.${nativeTarget}.node`
const addonHash = sha256(await readFile(join(root,addon)))
const entry = join(root,'dist',`compile-entry-${target}.ts`)
await writeFile(entry,`import addonPath from ${JSON.stringify('../'+addon)} with { type: 'file' };\nprocess.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;\nawait import('../app/main.tsx');\n`)
await run([process.execPath, 'build', '--compile', entry, '--outfile', join(out, 'jazzkeys'),
  '--define', 'JAZZKEYS_PACKAGED=true', '--define', `JAZZKEYS_WORKER_SHA256=${JSON.stringify(workerHash)}`,
  '--define', `JAZZKEYS_APPEARANCE_SHA256=${JSON.stringify(appearanceHash)}`])
let compilerSignatureBeforeRepair
if (process.platform === 'darwin') {
  compilerSignatureBeforeRepair = inspectMacCode(join(out, 'jazzkeys'))
  console.log(JSON.stringify({compilerSignatureBeforeRepair}))
  await signMacCode(join(out, 'jazzkeys'), 'io.jazzkeys.desktop.runtime')
  requireValidMacCode(join(out, 'jazzkeys'))
}
await copyFile(join(root, 'LICENSE'), join(out, 'LICENSE'))
await copyFile(join(root, 'THIRD-PARTY-NOTICES.md'), join(out, 'THIRD-PARTY-NOTICES.md'))
// Preserve committed notices and links, excluding ignored caches and untracked assets.
await copyCommittedDocs(root, commit, out)
const manifest = { schemaVersion: 1, product: 'Jazzkeys', version: (await Bun.file(join(root,'package.json')).json()).version, target,
  sourceCommit: commit, sourceTree, hardwareStatus: 'no_hardware_demo', signing: target === 'macos-arm64' ? 'ad-hoc development; no Developer ID or notarization' : 'unsigned',
  compilerSignatureBeforeRepair, bun: Bun.version, gpuix: '0.10.0', embeddedNativeAddonSha256:addonHash, workerVersion: '0.1.0', protocolVersion: 1,
  appearanceProtocolVersion:1, appearanceHelperSha256:appearanceHash,
  files: await Promise.all((await packageFiles(out)).map(async name => ({
    name, bytes: (await stat(join(out, name))).size, sha256: sha256(await readFile(join(out, name)))
  }))) }
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const smoke = Bun.spawn([join(out, 'jazzkeys'), '--package-self-test'], {cwd: out, env: {}, stdout:'inherit',stderr:'inherit'})
if (await smoke.exited !== 0) throw new Error('Installed-style package self-test failed without runtime environment')
const nativeSmoke = Bun.spawn([join(out,'jazzkeys'),'--native-self-test'],{cwd:out,env:{},stdout:'inherit',stderr:'inherit'})
if (await nativeSmoke.exited !== 0) throw new Error('Compiled native addon did not load without external packages')
console.log(`Packaged ${target}: ${out}. Native visual and hardware acceptance are separate.`)
