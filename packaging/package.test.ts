import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
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
