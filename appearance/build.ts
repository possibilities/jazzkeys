import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { signMacCode, requireValidMacCode } from '../packaging/sign-macos'

/** Host-only build; callers hash and package this exact output next to JazzKeys. */
export async function buildAppearanceHelper(output: string): Promise<void> {
  const root = resolve(import.meta.dir, '..')
  const args = ['cc', '-O2', '-Wall', '-Wextra', '-Werror']
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    args.push('-fobjc-arc', '-framework', 'Foundation', resolve(root, 'appearance/native/macos.m'))
  } else if (process.platform === 'linux' && process.arch === 'x64') {
    const pkg = Bun.spawnSync(['pkg-config', '--cflags', '--libs', 'gio-2.0', 'glib-2.0'], { stderr: 'inherit' })
    if (pkg.exitCode !== 0) throw new Error('Linux appearance build needs official GLib/GIO development headers and pkg-config')
    args.push(resolve(root, 'appearance/native/linux.c'), ...pkg.stdout.toString().trim().split(/\s+/))
  } else throw new Error('Appearance helper supports macOS ARM64 and Linux x86-64 GNU')
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  args.push('-o', destination)
  const build = Bun.spawn(args, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (await build.exited !== 0) throw new Error('Appearance helper compilation failed')
  if (process.platform === 'darwin') {
    await signMacCode(destination, 'io.jazzkeys.desktop.appearance')
    requireValidMacCode(destination)
  }
}
if (import.meta.main) await buildAppearanceHelper(process.argv[2] ?? resolve(import.meta.dir, '../dist/appearance/jazzkeys-appearance'))
