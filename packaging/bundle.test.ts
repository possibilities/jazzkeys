import { expect, test } from 'bun:test'
import { chmod, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bundleFileRecords, verifyBundle } from './verify-bundle'
import { bundleFixture, digest } from './test-fixtures'

for (const target of ['macos-arm64', 'linux-x64-gnu'] as const) {
  const clean = async (fixture: Awaited<ReturnType<typeof bundleFixture>>) => {
    await rm(fixture.dir, { recursive: true, force: true })
    await rm(fixture.flat.dir, { recursive: true, force: true })
  }
  test(`${target} bundle preserves the exact flat manifest and verifies its entire relocated inventory without executing binaries`, async () => {
    const fixture = await bundleFixture(target)
    try {
      expect((await verifyBundle(fixture.dir)).target).toBe(target)
      expect(await readFile(join(fixture.dir, fixture.manifest.sourceManifest), 'utf8'))
        .toBe(await readFile(join(fixture.flat.dir, 'manifest.json'), 'utf8'))
      expect(fixture.manifest.files.some(file => file.name.endsWith('/docs/licenses/React-MIT.txt'))).toBe(true)
    } finally { await clean(fixture) }
  })
  test(`${target} bundle detects changed documents and binaries, including a rewritten bundle hash record`, async () => {
    const fixture = await bundleFixture(target)
    try {
      for (const name of [`${fixture.layout.resources}/docs/licenses/React-MIT.txt`, `${fixture.layout.binaries}/jazzkeys`]) {
        const path = join(fixture.dir, name)
        const original = await readFile(path)
        await writeFile(path, 'modified installed bytes')
        await expect(verifyBundle(fixture.dir)).rejects.toThrow('Hash mismatch')
        fixture.manifest.files = await bundleFileRecords(fixture.dir)
        await fixture.save()
        await expect(verifyBundle(fixture.dir)).rejects.toThrow('Bundle differs from source package')
        await writeFile(path, original)
        fixture.manifest.files = await bundleFileRecords(fixture.dir)
        await fixture.save()
      }
    } finally { await clean(fixture) }
  })
  test(`${target} bundle detects missing and unlisted docs, and cannot drop docs from both inventories`, async () => {
    const fixture = await bundleFixture(target)
    try {
      const extra = join(fixture.dir, fixture.layout.resources, 'docs/unlisted.txt')
      await writeFile(extra, 'unlisted')
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('Unlisted package contents')
      fixture.manifest.files = await bundleFileRecords(fixture.dir)
      await fixture.save()
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('Unlisted bundle contents')
      await rm(extra)
      fixture.manifest.files = await bundleFileRecords(fixture.dir)
      await fixture.save()
      await rm(join(fixture.dir, fixture.layout.resources, 'docs'), { recursive: true })
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('Unlisted package contents or missing file')
      const source = { ...fixture.flat.manifest, files: fixture.flat.manifest.files.filter(file => !file.name.startsWith('docs/')) }
      const content = JSON.stringify(source)
      await writeFile(join(fixture.dir, fixture.manifest.sourceManifest), content)
      fixture.manifest.sourceManifestSha256 = digest(content)
      fixture.manifest.files = await bundleFileRecords(fixture.dir)
      await fixture.save()
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('required file missing')
    } finally { await clean(fixture) }
  })
  test(`${target} bundle rejects unsafe paths, source mismatch, and contradictory binary hash metadata`, async () => {
    const fixture = await bundleFixture(target)
    try {
      for (const change of [
        { sourceManifest: '../manifest.json' }, { application: '../JazzKeys' }, { sourceTree: 'f'.repeat(40) },
        { sourceCommit: 'bad' }, { product: 'Other' }, { protocolVersion: 2 },
        { appearanceProtocolVersion: 2 }, { workerSha256: '0'.repeat(64) },
        { files: [...fixture.manifest.files, { name: '../escaped', bytes: 3, sha256: 'a'.repeat(64) }] },
      ]) {
        await writeFile(join(fixture.dir, 'bundle-manifest.json'), JSON.stringify({ ...fixture.manifest, ...change }))
        await expect(verifyBundle(fixture.dir)).rejects.toThrow()
      }
    } finally { await clean(fixture) }
  })
  test(`${target} bundle rejects symlink resources and unsafe file/directory modes`, async () => {
    const fixture = await bundleFixture(target)
    try {
      const link = join(fixture.dir, fixture.layout.resources, 'docs/link')
      await symlink(join(fixture.dir, fixture.layout.resources, 'LICENSE'), link)
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('symlink')
      await rm(link)
      for (const name of ['bundle-manifest.json', '', fixture.layout.resources, `${fixture.layout.resources}/docs/licenses/React-MIT.txt`]) {
        const path = join(fixture.dir, name)
        await chmod(path, 0o777)
        await expect(verifyBundle(fixture.dir)).rejects.toThrow('Unsafe package')
        await chmod(path, name.endsWith('.json') || name.endsWith('.txt') ? 0o644 : 0o755)
      }
      await chmod(join(fixture.dir, fixture.layout.binaries, 'jazzkeys'), 0o644)
      await expect(verifyBundle(fixture.dir)).rejects.toThrow('not executable')
    } finally { await clean(fixture) }
  })
}

test('Mac bundle signing provenance binds the pre-seal input, sealed output, and fixed resource seal', async () => {
  const fixture = await bundleFixture('macos-arm64')
  try {
    const original = structuredClone(fixture.manifest)
    const variants = [
      { signingTransform: undefined },
      { sourceManifestScope: 'final sealed executable' },
      { signingTransform: {...original.signingTransform!, kind:'unknown'} },
      { signingTransform: {...original.signingTransform!, inputExecutableSha256:'f'.repeat(64)} },
      { signingTransform: {...original.signingTransform!, outputExecutableSha256:'f'.repeat(64)} },
      { signingTransform: {...original.signingTransform!, resourceSealSha256:'f'.repeat(64)} },
      { executableSha256:'f'.repeat(64) },
    ]
    for (const variant of variants) {
      await writeFile(join(fixture.dir,'bundle-manifest.json'),JSON.stringify({...original,...variant}))
      await expect(verifyBundle(fixture.dir)).rejects.toThrow()
    }
    await fixture.save()
    await verifyBundle(fixture.dir)
    const seal = join(fixture.dir,'JazzKeys.app/Contents/_CodeSignature/CodeResources')
    await rm(seal)
    await expect(verifyBundle(fixture.dir)).rejects.toThrow()
  } finally {
    await rm(fixture.dir,{recursive:true,force:true})
    await rm(fixture.flat.dir,{recursive:true,force:true})
  }
})

test('Linux bundles cannot claim a Mac signing transform', async () => {
  const fixture = await bundleFixture('linux-x64-gnu')
  try {
    await writeFile(join(fixture.dir,'bundle-manifest.json'),JSON.stringify({...fixture.manifest,signingTransform:{kind:'macos-adhoc-bundle-seal'}}))
    await expect(verifyBundle(fixture.dir)).rejects.toThrow('Unexpected bundle signing transform')
  } finally {
    await rm(fixture.dir,{recursive:true,force:true})
    await rm(fixture.flat.dir,{recursive:true,force:true})
  }
})
