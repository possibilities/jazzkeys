import { cp, mkdir, writeFile, lstat, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { hashArtifactFile, verifyPackage } from './verify-package'
import { bundleFileRecords, bundleLayout, verifyBundle } from './verify-bundle'

// A source companion and release checks are required before publishing this demo.
const root = resolve(import.meta.dir, '..')
const target = process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64'
  : process.platform === 'linux' && process.arch === 'x64' ? 'linux-x64-gnu' : null
if (!target) throw new Error('Unsupported host bundle target')
const flat = join(root,'dist',`jazzkeys-${target}`)
const source = await verifyPackage(flat)
const gitStatus = Bun.spawnSync(['git','status','--porcelain'],{cwd:root})
const commit = Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:root})
const tree = Bun.spawnSync(['git','rev-parse','HEAD^{tree}'],{cwd:root})
if (gitStatus.exitCode !== 0 || gitStatus.stdout.toString().trim() || commit.exitCode !== 0 || commit.stdout.toString().trim() !== source.sourceCommit ||
    tree.exitCode !== 0 || tree.stdout.toString().trim() !== source.sourceTree || source.target !== target) {
  throw new Error('Bundle inputs must come from the current clean committed source and matching compiled package')
}
const destination = join(root,'dist','install',target)
let existing: Awaited<ReturnType<typeof lstat>> | undefined
try {
  existing = await lstat(destination)
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Refusing unexpected bundle destination')
  await verifyBundle(destination)
  await rm(destination,{recursive:true})
}
await mkdir(destination,{recursive:true})
const layout = bundleLayout(target)
const app = join(destination,layout.application)
const binaries = join(destination,layout.binaries)
const resources = join(destination,layout.resources)
await mkdir(binaries,{recursive:true,mode:0o755})
await mkdir(resources,{recursive:true,mode:0o755})
for (const name of ['jazzkeys','jazzkeys-device','jazzkeys-appearance']) await cp(join(flat,name),join(binaries,name))
await cp(join(flat,'docs'),join(resources,'docs'),{recursive:true})
for (const name of ['LICENSE','THIRD-PARTY-NOTICES.md']) await cp(join(flat,name),join(resources,name))
await cp(join(flat,'manifest.json'),join(resources,'source-manifest.json'))
await writeFile(join(resources,'INSTALL.txt'),`Jazzkeys development demo\n\nHardware access is unavailable. No service or HID permission rule is installed.\n${process.platform === 'darwin' ? 'Requires Apple silicon and macOS 14.8.9 or later.\nUnzip the download, then move Jazzkeys.app into Applications (or keep it in your own folder).\nNo Rust, Xcode, Bun, or Node installation is needed.\nThis experimental demo is not Developer ID signed or notarized; macOS may block opening it.\nSee https://support.apple.com/en-us/102445 for Apple\'s security guidance. Do not disable system protections globally.\nTo uninstall, quit the app and remove Jazzkeys.app. No service or startup item is installed.\n' : 'Extract the directory and run bin/jazzkeys from a Wayland session with ZED_HEADLESS unset. The pinned renderer does not support native X11.\nThe measured native-addon floor is GLIBC 2.39; host GLib/GIO libraries are required.\nNo privileged installation is necessary. Remove the extracted directory to uninstall.\n'}\nThe release must include its exact corresponding-source companion beside the app download.\nSee THIRD-PARTY-NOTICES.md and docs/RELEASE.md for scope and limitations.\n`)
if (process.platform === 'darwin') {
  await writeFile(join(app,'Contents','Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleName</key><string>Jazzkeys</string>\n<key>CFBundleDisplayName</key><string>Jazzkeys</string>\n<key>CFBundleIdentifier</key><string>io.jazzkeys.desktop</string>\n<key>CFBundleExecutable</key><string>jazzkeys</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleShortVersionString</key><string>0.1.0</string>\n<key>CFBundleVersion</key><string>0.1.0</string>\n<key>JazzkeysBuildVersion</key><string>${source.version}</string>\n<key>LSMinimumSystemVersion</key><string>14.8.9</string>\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n`)
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
const manifest = {schemaVersion:1,product:'Jazzkeys',version:source.version,target,sourceCommit:source.sourceCommit,sourceTree:source.sourceTree,
  protocolVersion:source.protocolVersion,appearanceProtocolVersion:source.appearanceProtocolVersion,
  hardwareStatus:'no_hardware_demo',redistributionStatus:'source_companion_required',signing:layout.signing,
  layout:layout.layout,application:layout.application,
  sourceManifest:`${layout.resources}/source-manifest.json`,sourceManifestSha256:await hashArtifactFile(join(resources,'source-manifest.json')),
  executableSha256:await hashArtifactFile(executable),workerSha256:await hashArtifactFile(join(binaries,'jazzkeys-device')),
  appearanceHelperSha256:await hashArtifactFile(join(binaries,'jazzkeys-appearance')),files:await bundleFileRecords(destination),
  selfTest:JSON.parse(stdout.trim()),nativeLoadTest:JSON.parse(nativeOutput.trim())}
await writeFile(join(destination,'bundle-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
await verifyBundle(destination)
await mkdir(join(root,'artifacts','install'),{recursive:true})
await writeFile(join(root,'artifacts','install',`${target}.json`),JSON.stringify(manifest,null,2)+'\n')
console.log(`Verified experimental demo bundle: ${app}. Publish only with its exact source companion.`)
