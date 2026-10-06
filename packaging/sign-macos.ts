import { resolve } from 'node:path'

/** Development signatures only. Never search the keychain or change OS policy. */
export async function signMacCode(path: string, identifier: string): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Mac signing requires the native ARM64 build host')
  if (!/^io\.jazzkeys\.desktop(?:\.[a-z]+)?$/.test(identifier)) throw new Error('Unexpected development signing identifier')
  const command = Bun.spawn(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none',
    '--identifier', identifier, resolve(path)], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited])
  if (code !== 0) throw new Error(`Ad-hoc development signing failed: ${stderr || stdout}`)
}

/** codesign display is not verification. These checks do not launch the app. */
export function inspectMacCode(path: string, deep = false) {
  const result = Bun.spawnSync(['/usr/bin/codesign', '--verify', '--strict', ...(deep ? ['--deep'] : []), '--verbose=2', resolve(path)], { stdout: 'pipe', stderr: 'pipe' })
  return { verified: result.exitCode === 0, exitCode: result.exitCode,
    detail: (result.stderr.toString() || result.stdout.toString()).replaceAll(resolve(path), '<artifact>').slice(0,8192) }
}

export function requireValidMacCode(path: string, deep = false) {
  const result = inspectMacCode(path, deep)
  if (!result.verified) throw new Error(`Strict code signature verification failed: ${result.detail}`)
  return result
}
