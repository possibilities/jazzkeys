import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage } from './verify-package'

test('package rejects an unexpected executable and traversal before reading contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jazzkeys-package-'))
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({schemaVersion: 1, hardwareStatus:'no_hardware_demo', files:[{name:'../unexpected'}]}))
    await expect(verifyPackage(dir)).rejects.toThrow('Unexpected package contents')
  } finally { await rm(dir, {recursive: true, force: true}) }
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(),'jazzkeys-notices-'))
  const contents: Record<string,string> = {LICENSE:'project license','THIRD-PARTY-NOTICES.md':'See docs/licenses/notice.txt',jazzkeys:'app','jazzkeys-device':'worker','docs/licenses/notice.txt':'upstream notice'}
  await mkdir(join(dir,'docs/licenses'),{recursive:true})
  for (const [name,body] of Object.entries(contents)) await writeFile(join(dir,name),body)
  const manifest = {schemaVersion:1,hardwareStatus:'no_hardware_demo',files:Object.entries(contents).map(([name,body])=>({name,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}))}
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest))
  return {dir,manifest}
}
test('nested notices are listed and verified byte-for-byte',async()=>{
  const {dir}=await fixture()
  try {
    expect((await verifyPackage(dir)).files.length).toBe(5)
    await writeFile(join(dir,'docs/licenses/notice.txt'),'changed notice')
    await expect(verifyPackage(dir)).rejects.toThrow('Hash mismatch')
  } finally {await rm(dir,{recursive:true,force:true})}
})
test('unlisted documents, symlink resources and duplicate records fail closed',async()=>{
  const {dir,manifest}=await fixture()
  try {
    await writeFile(join(dir,'docs/extra.txt'),'unlisted')
    await expect(verifyPackage(dir)).rejects.toThrow('Unlisted package contents')
    await rm(join(dir,'docs/extra.txt'))
    await symlink(join(dir,'LICENSE'),join(dir,'docs/link'))
    await expect(verifyPackage(dir)).rejects.toThrow('symlink')
    await rm(join(dir,'docs/link'))
    manifest.files.push(manifest.files[0]!)
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest))
    await expect(verifyPackage(dir)).rejects.toThrow('Unexpected package contents')
  } finally {await rm(dir,{recursive:true,force:true})}
})
