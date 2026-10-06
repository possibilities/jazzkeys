import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildAppearanceHelper } from './build'
import { parseAppearanceFrame, type SystemAppearanceSnapshot } from './protocol'

const root = resolve(import.meta.dir, '..')
const directory = resolve(root, 'dist/appearance-tests')
const executable = resolve(directory, 'jazzkeys-appearance')
const children: Bun.Subprocess<'pipe', 'pipe', 'inherit'>[] = []
const limit = async <T>(promise: Promise<T>, message: string, ms = 3_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]) }
  finally { clearTimeout(timer) }
}
class Lines {
  values: string[] = []
  count = 0
  private waiters: ((value: string) => void)[] = []
  constructor(stream: ReadableStream<Uint8Array>) {
    void (async () => {
      let pending = ''
      for await (const bytes of stream) {
        pending += Buffer.from(bytes).toString('utf8')
        let index: number
        while ((index = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, index); pending = pending.slice(index + 1); this.count++
          const waiting = this.waiters.shift()
          if (waiting) waiting(line); else this.values.push(line)
        }
      }
    })()
  }
  next(): Promise<string> {
    const value = this.values.shift()
    return value === undefined ? limit(new Promise(resolve => this.waiters.push(resolve)), 'Native helper did not produce expected frame') : Promise.resolve(value)
  }
  async expect(appearance: SystemAppearanceSnapshot['appearance'], availability: SystemAppearanceSnapshot['availability']) {
    assert.deepEqual(parseAppearanceFrame(await this.next()), { appearance, availability })
  }
}
function start(args: string[], env: Record<string, string | undefined> = process.env) {
  const child = Bun.spawn(args, { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  children.push(child)
  return { child, output: new Lines(child.stdout) }
}
async function stop(child: ReturnType<typeof start>['child']) {
  child.stdin.end()
  assert.equal(await limit(child.exited, 'Observer remained alive after stdin EOF', 1_500), 0)
}
async function parentDeath(helper: string, env: Record<string, string | undefined> = process.env) {
  const holder = start([process.execPath, resolve(import.meta.dir, 'tests/orphan-holder.ts'), helper], env)
  const { pid } = JSON.parse(await holder.output.next()) as { pid: number }
  parseAppearanceFrame(await holder.output.next())
  const before = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)]).stdout.toString().trim()
  assert.ok(before && !before.startsWith('Z'), 'Observer must be alive before its parent is killed')
  holder.child.kill('SIGKILL')
  await holder.child.exited
  const deadline = Date.now() + 1_500
  while (Date.now() < deadline) {
    const status = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)]).stdout.toString().trim()
    if (!status || status.startsWith('Z')) return
    await Bun.sleep(20)
  }
  throw new Error('Appearance helper survived parent death')
}
async function fallback() {
  const noBus = start([executable], {})
  await noBus.output.expect(null, 'unavailable')
  assert.equal(await limit(noBus.child.exited, 'Missing bus did not finish'), 0)
  const failedBus = start([executable], { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/jazzkeys-test-bus' })
  await failedBus.output.expect(null, 'unavailable'); await stop(failedBus.child)
  await parentDeath(executable, { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/jazzkeys-test-bus' })
  console.log('Linux native fallback: missing session, failed session connection, EOF shutdown and abrupt parent-death shutdown passed')
}
async function linux() {
  // This process always runs inside the disposable dbus-run-session created below.
  const observer = start([executable])
  await observer.output.expect(null, 'unavailable')
  const portal = start(['/usr/bin/python3', 'appearance/tests/fake-portal.py'])
  assert.deepEqual(JSON.parse(await portal.output.next()), { ready: true })
  await observer.output.expect('dark', 'live')
  portal.child.stdin.write('light\n'); await observer.output.expect('light', 'live')
  portal.child.stdin.write('malformed\n'); await observer.output.expect('light', 'read-once')
  portal.child.stdin.write('dark\n'); await observer.output.expect('dark', 'live')
  portal.child.stdin.write('none\n'); await observer.output.expect('light', 'live')
  const before = observer.output.count
  portal.child.stdin.write('unknown\n'); portal.child.stdin.write('unrelated\n')
  await Bun.sleep(75)
  assert.equal(observer.output.count, before, 'No-preference, unknown enum and unrelated signal must not invent a change')
  portal.child.stdin.write('lose\n'); await observer.output.expect('light', 'read-once')
  portal.child.stdin.write('regain\n'); await portal.output.next(); await observer.output.expect('light', 'live')
  await parentDeath(executable)
  await stop(observer.child)
  await stop(portal.child)

  for (const flag of ['--single-variant', '--read-fails']) {
    const fixture = start(['/usr/bin/python3', 'appearance/tests/fake-portal.py', flag])
    await fixture.output.next()
    const helper = start([executable])
    await helper.output.expect(flag === '--read-fails' ? null : 'dark', flag === '--read-fails' ? 'unavailable' : 'live')
    fixture.child.stdin.write('light\n'); await helper.output.expect('light', 'live')
    // Input is a lifetime channel, never a command endpoint.
    helper.child.stdin.write('anything\n')
    assert.equal(await limit(helper.child.exited, 'Helper interpreted stdin as commands'), 0)
    await stop(fixture.child)
  }
  console.log('Linux native appearance: initial read; live light/dark; no preference; malformed/unrelated signal; owner loss/recovery; unavailable/read error; EOF/input/parent-death shutdown passed on an isolated real GIO/D-Bus session')
}
async function macos() {
  const fixturePath = resolve(directory, 'jazzkeys-appearance-test-only')
  const driverPath = resolve(directory, 'jazzkeys-appearance-test-driver')
  for (const [source, output, defines] of [
    ['appearance/native/macos.m', fixturePath, ['-DJAZZKEYS_APPEARANCE_TEST=1']],
    ['appearance/tests/macos-driver.m', driverPath, []],
  ] as const) {
    const compiler = Bun.spawn(['cc', '-O2', '-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-framework', 'Foundation', ...defines, source, '-o', output], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await compiler.exited, 0, 'macOS native fixture must compile')
  }
  const driver = start([driverPath]); await driver.output.next()
  const observer = start([fixturePath]); await observer.output.expect('light', 'live')
  driver.child.stdin.write('dark\n'); await observer.output.expect('dark', 'live')
  driver.child.stdin.write('light\n'); await observer.output.expect('light', 'live')
  driver.child.stdin.write('malformed\n'); await observer.output.expect(null, 'unavailable')
  driver.child.stdin.write('none\n'); await observer.output.expect('light', 'live')
  await parentDeath(fixturePath)
  await stop(observer.child); await stop(driver.child)
  // A separate production read checks the real API without altering the real preference.
  const actual = start([executable])
  const snapshot = parseAppearanceFrame(await actual.output.next())
  assert.ok(['live', 'unavailable'].includes(snapshot.availability))
  await stop(actual.child)
  console.log('macOS native appearance: synthetic preference domain + distributed notifications, production read, and EOF/parent-death shutdown passed; actual user theme toggles were not performed')
}

try {
  await mkdir(directory, { recursive: true })
  if (process.platform === 'linux' && !process.argv.includes('--isolated')) {
    await buildAppearanceHelper(executable)
    await fallback()
    if (process.argv.includes('--fallback-only')) process.exit(0)
    const runtime = await mkdtemp(resolve(tmpdir(), 'jazzkeys-appearance-bus-'))
    try {
      const child = Bun.spawn(['dbus-run-session', '--', process.execPath, import.meta.path, '--isolated'], { cwd: root, env: { ...process.env, XDG_RUNTIME_DIR: runtime }, stdout: 'inherit', stderr: 'inherit', stdin: 'ignore' })
      assert.equal(await child.exited, 0, 'Isolated portal integration failed')
    } finally { await rm(runtime, { recursive: true, force: true }) }
  } else if (process.platform === 'linux') await linux()
  else if (process.platform === 'darwin' && process.arch === 'arm64') { await buildAppearanceHelper(executable); await macos() }
  else throw new Error('Unsupported native appearance test platform')
} finally {
  for (const child of children) if (child.exitCode === null) { child.stdin.end(); child.kill('SIGTERM') }
}
