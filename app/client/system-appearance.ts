import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { observeAppearanceHelper, unavailableSource, type ManagedSystemAppearanceSource } from '../../appearance/observer'

declare const JAZZKEYS_APPEARANCE_SHA256: string
export type { ManagedSystemAppearanceSource } from '../../appearance/observer'

/** Fixed app-relative executable only. No caller-selected helper, command or override. */
export async function createSystemAppearanceSource(): Promise<ManagedSystemAppearanceSource> {
  if (typeof JAZZKEYS_APPEARANCE_SHA256 === 'undefined' || !/^[a-f0-9]{64}$/.test(JAZZKEYS_APPEARANCE_SHA256)) return unavailableSource()
  if (!(process.platform === 'darwin' && process.arch === 'arm64') && !(process.platform === 'linux' && process.arch === 'x64')) return unavailableSource()
  try {
    const directory = await realpath(dirname(process.execPath))
    const path = join(directory, 'jazzkeys-appearance')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || !(info.mode & 0o111) ||
        info.size > 4_194_304 || await realpath(path) !== path) return unavailableSource()
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== JAZZKEYS_APPEARANCE_SHA256) return unavailableSource()
    const env: Record<string, string> = {}
    // No inherited loader overrides, PATH commands, test domains, or theme overrides.
    if (process.env.HOME) env.HOME = process.env.HOME
    if (process.platform === 'linux') {
      const address = process.env.DBUS_SESSION_BUS_ADDRESS
      if (address && address.length <= 4096 && /^unix:(path|abstract)=/.test(address) && !address.includes(';')) env.DBUS_SESSION_BUS_ADDRESS = address
      else if (process.env.XDG_RUNTIME_DIR?.startsWith('/') && !/[\n\r,;=]/.test(process.env.XDG_RUNTIME_DIR)) {
        env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${process.env.XDG_RUNTIME_DIR}/bus`
      } else return unavailableSource()
    }
    const child = Bun.spawn([path], { cwd: directory, env, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    const source = await observeAppearanceHelper({ stdout: child.stdout, exited: child.exited, stop() {
      // EOF is independently observed by both helpers, including on parent crash.
      try { child.stdin.end() } catch { /* The helper may already have closed the pipe. */ }
      if (child.exitCode === null) child.kill('SIGTERM')
    } })
    const dispose = source.dispose.bind(source)
    const onExit = () => dispose()
    process.once('exit', onExit)
    source.dispose = () => { process.removeListener('exit', onExit); dispose() }
    return source
  } catch { return unavailableSource() }
}
