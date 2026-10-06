import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRelativeArtifactPath } from './verify-package'

/** Materialize documentation bytes from one immutable Git commit, never the worktree. */
export async function copyCommittedDocs(repository: string, commit: string, destination: string): Promise<string[]> {
  if (commit.length !== 40 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected an exact source commit')
  const git = (args: string[], maxBuffer = 4_194_304) => {
    const result = Bun.spawnSync(['git', '--no-replace-objects', '-C', repository, ...args], {
      stdout: 'pipe', stderr: 'pipe', maxBuffer, timeout: 10_000,
    })
    if (result.exitCode !== 0) throw new Error('Cannot read committed package documentation')
    return result.stdout
  }
  if (git(['cat-file', '-t', commit]).toString().trim() !== 'commit') throw new Error('Expected a source commit object')
  const listing = git(['ls-tree', '-r', '-z', commit, '--', 'docs'])
  const text = listing.toString('utf8')
  if (!Buffer.from(text).equals(listing) || !text.endsWith('\0')) throw new Error('Missing or invalid committed docs tree')
  const records = text.slice(0, -1).split('\0').map(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(record)
    if (!match || !isRelativeArtifactPath(match[3]) || !match[3].startsWith('docs/') || match[3].split('/').length > 13) {
      throw new Error('Unsafe committed documentation path or non-regular mode')
    }
    return { name: match[3], blob: match[2]!, mode: match[1] === '100755' ? 0o755 : 0o644 }
  })
  if (records.length > 10_000 || new Set(records.map(record => record.name)).size !== records.length) throw new Error('Invalid committed docs inventory')
  const root = await lstat(destination)
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o6022)) throw new Error('Unsafe documentation destination')
  const directories = new Set<string>()
  for (const record of records) {
    const parts = record.name.split('/')
    for (let depth = 1; depth < parts.length; depth++) {
      const relative = parts.slice(0, depth).join('/')
      if (directories.has(relative)) continue
      const path = join(destination, relative)
      try { await mkdir(path, { mode: 0o755 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o6022)) throw new Error('Unsafe documentation destination directory')
      directories.add(relative)
    }
    const bytes = git(['cat-file', 'blob', record.blob], 33_554_432)
    await writeFile(join(destination, record.name), bytes, { mode: record.mode, flag: 'wx' })
  }
  return records.map(record => record.name)
}
