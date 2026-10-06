import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

// Host-platform builds only. No installer, downloads, device access, or signing.
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
await mkdir(out, { recursive: true, mode: 0o755 })
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Build failed: ${args[0]}`)
}
await run(['cargo', 'build', '--manifest-path', 'device/Cargo.toml', '--locked', '--release'])
const worker = join(out, 'jazzkeys-device')
await copyFile(join(root, 'device/target/release/jazzkeys-device'), worker)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const workerHash = sha256(await readFile(worker))
await run([process.execPath, 'build', '--compile', 'app/main.tsx', '--outfile', join(out, 'jazzkeys'),
  '--define', 'JAZZKEYS_PACKAGED=true', '--define', `JAZZKEYS_WORKER_SHA256=${JSON.stringify(workerHash)}`])
await copyFile(join(root, 'LICENSE'), join(out, 'LICENSE'))
await copyFile(join(root, 'THIRD-PARTY-NOTICES.md'), join(out, 'THIRD-PARTY-NOTICES.md'))
const manifest = { schemaVersion: 1, product: 'Jazzkeys', version: '0.1.0-dev.0', target,
  sourceCommit: commit, sourceTree, hardwareStatus: 'no_hardware_demo', signing: 'unsigned',
  bun: Bun.version, gpuix: '0.10.0', workerVersion: '0.1.0', protocolVersion: 1,
  files: await Promise.all((await readdir(out)).filter(name => name !== 'manifest.json').map(async name => ({
    name, bytes: (await stat(join(out, name))).size, sha256: sha256(await readFile(join(out, name)))
  }))) }
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const smoke = Bun.spawn([join(out, 'jazzkeys'), '--package-self-test'], {cwd: out, env: {}, stdout:'inherit',stderr:'inherit'})
if (await smoke.exited !== 0) throw new Error('Installed-style package self-test failed without runtime environment')
console.log(`Packaged ${target}: ${out}. Native visual and hardware acceptance are separate.`)
