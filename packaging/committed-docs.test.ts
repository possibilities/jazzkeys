import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyCommittedDocs } from './committed-docs'

// These temporary Git objects are test data; no product repository is committed.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jazzkeys-committed-docs-'))
  const repository = join(directory, 'repository')
  const output = join(directory, 'output')
  await mkdir(join(repository, 'docs/licenses'), { recursive: true })
  await mkdir(output)
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', '-C', repository, ...args], { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return result.stdout.toString().trim()
  }
  git('init', '-q')
  await writeFile(join(repository, '.gitignore'), '__pycache__/\n*.pyc\n')
  await writeFile(join(repository, 'docs/README.md'), 'committed documentation\n')
  await writeFile(join(repository, 'docs/licenses/notice.txt'), 'committed license text\n')
  git('add', '--', '.gitignore', 'docs')
  const snapshot = () => git('-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', git('write-tree'), '-m', 'Offline source snapshot')
  return { directory, repository, output, git, snapshot, commit: snapshot() }
}

test('committed docs exclude ignored caches and untracked files and use pinned blob bytes', async () => {
  const fixtureData = await fixture()
  const { repository, output, commit } = fixtureData
  try {
    await mkdir(join(repository, 'docs/__pycache__'))
    await writeFile(join(repository, 'docs/__pycache__/acceptance.cpython.pyc'), 'ignored bytecode')
    await writeFile(join(repository, 'docs/untracked.txt'), 'untracked content')
    await writeFile(join(repository, 'docs/README.md'), 'later worktree bytes must not ship')
    expect(await copyCommittedDocs(repository, commit, output)).toEqual(['docs/README.md', 'docs/licenses/notice.txt'])
    expect((await readdir(join(output, 'docs'))).sort()).toEqual(['README.md', 'licenses'])
    expect(await readFile(join(output, 'docs/README.md'), 'utf8')).toBe('committed documentation\n')
    expect(await readFile(join(output, 'docs/licenses/notice.txt'), 'utf8')).toBe('committed license text\n')
  } finally { await rm(fixtureData.directory, { recursive: true, force: true }) }
})

test('committed docs refuse symlink modes and unsafe tracked paths before copying', async () => {
  for (const unsafe of ['symlink', 'path'] as const) {
    const fixtureData = await fixture()
    try {
      if (unsafe === 'symlink') {
        const blob = fixtureData.git('rev-parse', `${fixtureData.commit}:docs/README.md`)
        fixtureData.git('update-index', '--add', '--cacheinfo', '120000', blob, 'docs/linked')
      } else {
        await writeFile(join(fixtureData.repository, 'docs/bad\nname.txt'), 'unsafe path')
        fixtureData.git('add', '--', 'docs')
      }
      await expect(copyCommittedDocs(fixtureData.repository, fixtureData.snapshot(), fixtureData.output)).rejects.toThrow('Unsafe committed documentation')
      expect(await readdir(fixtureData.output)).toEqual([])
    } finally { await rm(fixtureData.directory, { recursive: true, force: true }) }
  }
})
