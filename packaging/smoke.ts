import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPackage } from './verify-package'

const source = resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu')
await verifyPackage(source)
const scratch = await mkdtemp(join(tmpdir(), 'Jazzkeys installed test '))
try {
  const installed = join(scratch, 'A folder with spaces')
  await cp(source, installed, {recursive:true, errorOnExist:true})
  const run = async () => {
    const process = Bun.spawn([join(installed,'jazzkeys'),'--package-self-test'],{cwd:scratch,env:{PATH:''},stdout:'pipe',stderr:'pipe'})
    const [stdout,stderr,code] = await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited])
    return {stdout,stderr,code}
  }
  const clean = await run()
  if (clean.code !== 0 || !clean.stdout.includes('"hardwareAccess":false')) throw new Error(`Compiled app/worker relocation failed: ${clean.stderr}`)
  const worker = join(installed,'jazzkeys-device')
  const bytes = await readFile(worker)
  bytes[bytes.length-1] = bytes[bytes.length-1]! ^ 1
  await writeFile(worker,bytes)
  const tampered = await run()
  if (tampered.code === 0 || !tampered.stderr.includes('integrity mismatch')) throw new Error('Tampered worker did not fail closed')
  console.log('Relocated compiled package works without Bun/Node/PATH; tampered worker rejected before launch. No native window or HID opened.')
} finally { await rm(scratch,{recursive:true,force:true}) }
