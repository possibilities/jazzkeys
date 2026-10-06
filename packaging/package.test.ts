import { test, expect } from 'bun:test'
import { chmod, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredPackageFiles, verifyPackage } from './verify-package'
import { packageFixture } from './test-fixtures'

test('package rejects traversal and an unexpected executable before reading file contents', async () => {
  const fixture = await packageFixture()
  try {
    for (const name of ['../unexpected', '/absolute', 'docs/../outside', 'docs\\outside', 'other-executable', 'docs/invalid\u0000name']) {
      const files = fixture.manifest.files
      fixture.manifest.files = [...files, { name, bytes: 1, sha256: 'a'.repeat(64) }]
      await fixture.save()
      await expect(verifyPackage(fixture.dir)).rejects.toThrow('Unexpected package contents')
      fixture.manifest.files = files
    }
  } finally { await rm(fixture.dir, { recursive: true, force: true }) }
})

test('nested notices are listed and verified byte-for-byte', async () => {
  const { dir, manifest } = await packageFixture()
  try {
    expect((await verifyPackage(dir)).files.length).toBe(requiredPackageFiles.length + 1)
    expect((await verifyPackage(dir)).sourceCommit).toBe(manifest.sourceCommit)
    await writeFile(join(dir, 'docs/licenses/React-MIT.txt'), 'changed notice')
    await expect(verifyPackage(dir)).rejects.toThrow('Hash mismatch')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('required docs and license texts cannot disappear together with their manifest records', async () => {
  const fixture = await packageFixture()
  try {
    for (const group of ['docs/licenses/', 'docs/']) {
      fixture.manifest.files = fixture.manifest.files.filter(file => !file.name.startsWith(group))
      await rm(join(fixture.dir, group), { recursive: true, force: true })
      await fixture.save()
      await expect(verifyPackage(fixture.dir)).rejects.toThrow('required file missing')
    }
  } finally { await rm(fixture.dir, { recursive: true, force: true }) }
})

test('unlisted documents, symlink resources and duplicate records fail closed', async () => {
  const { dir, manifest, save } = await packageFixture()
  try {
    await writeFile(join(dir, 'docs/unlisted.txt'), 'unlisted')
    await expect(verifyPackage(dir)).rejects.toThrow('Unlisted package contents')
    await rm(join(dir, 'docs/unlisted.txt'))
    await symlink(join(dir, 'LICENSE'), join(dir, 'docs/link'))
    await expect(verifyPackage(dir)).rejects.toThrow('symlink')
    await rm(join(dir, 'docs/link'))
    manifest.files.push(manifest.files[0]!)
    await save()
    await expect(verifyPackage(dir)).rejects.toThrow('Unexpected package contents')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('source, product, target, protocol and helper hash metadata are required and consistent', async () => {
  const fixture = await packageFixture()
  try {
    for (const change of [
      { sourceCommit: undefined }, { sourceTree: 'not-a-commit' }, { product: 'Another app' },
      { target: 'windows-x64' }, { protocolVersion: 2 }, { appearanceProtocolVersion: undefined },
      { embeddedNativeAddonSha256: 'bad' }, { appearanceHelperSha256: 'f'.repeat(64) },
      { sourceCommit: 'a'.repeat(40) + '\n' }, { embeddedNativeAddonSha256: 'e'.repeat(64) + '\n' },
    ]) {
      await writeFile(join(fixture.dir, 'manifest.json'), JSON.stringify({ ...fixture.manifest, ...change }))
      await expect(verifyPackage(fixture.dir)).rejects.toThrow()
    }
  } finally { await rm(fixture.dir, { recursive: true, force: true }) }
})

test('unsafe manifest, root and nested directory modes are rejected', async () => {
  const fixture = await packageFixture()
  try {
    for (const name of ['manifest.json', '', 'docs/licenses']) {
      const path = join(fixture.dir, name)
      await chmod(path, 0o777)
      await expect(verifyPackage(fixture.dir)).rejects.toThrow('Unsafe package')
      await chmod(path, name === 'manifest.json' ? 0o644 : 0o755)
    }
    await chmod(join(fixture.dir, 'jazzkeys-appearance'), 0o644)
    await expect(verifyPackage(fixture.dir)).rejects.toThrow('not executable')
  } finally { await rm(fixture.dir, { recursive: true, force: true }) }
})
