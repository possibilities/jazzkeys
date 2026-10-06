import { cp, mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { verifyPackage } from './verify-package'

// Local development bundle construction does not authorize redistribution.
const root = resolve(import.meta.dir, '..')
const target = process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64'
  : process.platform === 'linux' && process.arch === 'x64' ? 'linux-x64-gnu' : null
if (!target) throw new Error('Unsupported host bundle target')
const flat = join(root,'dist',`jazzkeys-${target}`)
const source = await verifyPackage(flat)
const gitStatus = Bun.spawnSync(['git','status','--porcelain'],{cwd:root})
const commit = Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:root})
if (gitStatus.exitCode !== 0 || gitStatus.stdout.toString().trim() || commit.exitCode !== 0 || commit.stdout.toString().trim() !== source.sourceCommit) {
  throw new Error('Bundle inputs must come from the current clean committed source and matching compiled package')
}
const destination = join(root,'dist','install',target)
let existing: Awaited<ReturnType<typeof lstat>> | undefined
try {
  existing = await lstat(destination)
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Refusing unexpected bundle destination')
  const previous = JSON.parse(await readFile(join(destination,'bundle-manifest.json'),'utf8'))
  if (previous.product !== 'Jazzkeys' || previous.schemaVersion !== 1) throw new Error('Refusing to replace an unrecognized bundle')
  await rm(destination,{recursive:true})
}
await mkdir(destination,{recursive:true})
const app = process.platform === 'darwin' ? join(destination,'Jazzkeys.app') : join(destination,'jazzkeys')
const binaries = process.platform === 'darwin' ? join(app,'Contents','MacOS') : join(app,'bin')
const resources = process.platform === 'darwin' ? join(app,'Contents','Resources') : join(app,'share')
await mkdir(binaries,{recursive:true,mode:0o755})
await mkdir(resources,{recursive:true,mode:0o755})
for (const name of ['jazzkeys','jazzkeys-device','jazzkeys-appearance']) await cp(join(flat,name),join(binaries,name))
await cp(join(flat,'docs'),join(resources,'docs'),{recursive:true})
for (const name of ['LICENSE','THIRD-PARTY-NOTICES.md']) await cp(join(root,name),join(resources,name))
await writeFile(join(resources,'INSTALL.txt'),`Jazzkeys development demo\n\nHardware access is unavailable. No service or HID permission rule is installed.\n${process.platform === 'darwin' ? 'This is an unsigned/development app bundle. It is not Developer ID signed or notarized.\nDo not disable system protections globally.\n' : 'Extract the directory and run bin/jazzkeys. The measured native-addon floor is GLIBC 2.39.\nNo privileged installation is necessary. Remove the extracted directory to uninstall.\n'}\nThe bundled notices are an inventory in progress, not redistribution clearance.\nSee THIRD-PARTY-NOTICES.md and VERIFICATION.md before redistribution.\n`)
if (process.platform === 'darwin') {
  await writeFile(join(app,'Contents','Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleName</key><string>Jazzkeys</string>\n<key>CFBundleDisplayName</key><string>Jazzkeys</string>\n<key>CFBundleIdentifier</key><string>io.jazzkeys.desktop</string>\n<key>CFBundleExecutable</key><string>jazzkeys</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleShortVersionString</key><string>0.1.0</string>\n<key>CFBundleVersion</key><string>0.1.0</string>\n<key>LSMinimumSystemVersion</key><string>14.8.9</string>\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n`)
  const plist = Bun.spawnSync(['plutil','-lint',join(app,'Contents','Info.plist')],{stdout:'pipe',stderr:'pipe'})
  if (plist.exitCode !== 0) throw new Error(plist.stderr.toString() || plist.stdout.toString())
}
const executable = join(binaries,'jazzkeys')
const smoke = Bun.spawn([executable,'--package-self-test'],{cwd:dirname(app),env:{PATH:''},stdout:'pipe',stderr:'pipe'})
const [stdout,stderr,code] = await Promise.all([new Response(smoke.stdout).text(),new Response(smoke.stderr).text(),smoke.exited])
if (code !== 0 || !stdout.includes('"hardwareAccess":false')) throw new Error(`Bundle integrity/relocation failed: ${stderr}`)
const nativeSmoke = Bun.spawn([executable,'--native-self-test'],{cwd:dirname(app),env:{PATH:''},stdout:'pipe',stderr:'pipe'})
const [nativeOutput,nativeError,nativeCode] = await Promise.all([new Response(nativeSmoke.stdout).text(),new Response(nativeSmoke.stderr).text(),nativeSmoke.exited])
if (nativeCode !== 0 || !nativeOutput.includes('"rendererBinding":"native"')) throw new Error(`Bundled native renderer failed to load: ${nativeError}`)
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
const manifest = {schemaVersion:1,product:'Jazzkeys',target,sourceCommit:source.sourceCommit,sourceTree:source.sourceTree,
  hardwareStatus:'no_hardware_demo',redistributionStatus:'review_pending',signing:process.platform==='darwin' ? 'no Developer ID or notarization' : 'unsigned ELF files',
  layout:process.platform==='darwin' ? 'macOS app bundle' : 'unprivileged relocatable directory',
  application:app.slice(destination.length+1),executableSha256:await hash(executable),workerSha256:await hash(join(binaries,'jazzkeys-device')),
  appearanceHelperSha256:await hash(join(binaries,'jazzkeys-appearance')),
  selfTest:JSON.parse(stdout.trim()),nativeLoadTest:JSON.parse(nativeOutput.trim())}
await writeFile(join(destination,'bundle-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
await mkdir(join(root,'artifacts','install'),{recursive:true})
await writeFile(join(root,'artifacts','install',`${target}.json`),JSON.stringify(manifest,null,2)+'\n')
console.log(`Verified local development bundle: ${app}. Redistribution remains gated.`)
