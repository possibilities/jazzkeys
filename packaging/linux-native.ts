import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { App, connectStdio } from '@gpuix/native/automation'
import { __napiBindingTarget } from '@gpuix/native'
import { startRuntimeTrace } from './runtime-trace'

if (process.platform !== 'linux' || process.arch !== 'x64' || Bun.version !== '1.3.10'
  || __napiBindingTarget !== 'native' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.JAZZKEYS_HEADLESS_X11 !== '1' || !process.env.DISPLAY
  || process.env.JAZZKEYS_NETWORK_NAMESPACE !== '1' || process.env.WAYLAND_DISPLAY
  || process.getuid?.() === 0) throw new Error('Use linux-xvfb.sh in isolated ordinary-user Linux CI')

const root = resolve(import.meta.dir, '..')
const out = join(root, 'artifacts/linux-native')
const packageDirectory = resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu')
await mkdir(out, { recursive: true })
const evidence: unknown[] = []
const within = async <T>(promise: Promise<T>, label: string, milliseconds = 15_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
const run = async (args: string[]): Promise<string> => {
  const child = Bun.spawn(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await within(Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]), args[0]!)
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`)
  return stdout.trim()
}
const waitFor = async (condition: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 12_000
  do {
    if (await within(condition(), label)) return
    await Bun.sleep(60)
  } while (Date.now() < deadline)
  throw new Error(`Native state did not arrive: ${label}`)
}
type PipeChild = Bun.Subprocess<'pipe', 'pipe', 'pipe'>
async function connect(child: PipeChild, stop: () => void): Promise<App> {
  try {
    return await within(connectStdio({
      write: chunk => { child.stdin.write(chunk) },
      feed: listener => {
        void (async () => {
          const decoder = new TextDecoder()
          for await (const chunk of child.stdout) listener(decoder.decode(chunk, { stream: true }))
          listener(decoder.decode())
        })().catch(error => { console.error('Native pipe failed', error); stop() })
      },
      close: async () => { stop() },
    }), 'live native automation startup', 30_000)
  } catch (error) { stop(); throw error }
}
async function ready(app: App) {
  await waitFor(async () => (await app.call('getPaintedText', {})).text.some(text => text.includes('Jazzkeys')), 'painted Jazzkeys window')
  const all = (await app.call('getAllText', {})).text
  if (all.some(text => text.includes('Uncaught runtime errors:'))) throw new Error('Native runtime error overlay appeared')
}
async function capture(app: App, name: string, width: number, height: number) {
  await ready(app)
  await Bun.sleep(180) // Allow the asynchronous live UI thread to present its completed frame.
  const { pid } = await within(app.call('initialize', { protocolVersion: 1, client: 'jazzkeys-linux-acceptance' }), 'native identity')
  const windows = (await run(['xdotool', 'search', '--onlyvisible', '--pid', String(pid), '--name', '^Jazzkeys( Linux fixture)?$'])).split('\n')
  if (windows.length !== 1 || !/^\d+$/.test(windows[0]!)) throw new Error(`Expected exactly one Jazzkeys X11 window for PID ${pid}`)
  const windowId = windows[0]!
  const file = join(out, `${name}.png`)
  await writeFile(join(out, `${name}.x11.txt`), await run(['xwininfo', '-id', windowId]))
  await run(['import', '-silent', '-window', windowId, file])
  const pixels = JSON.parse(await run(['python3', 'packaging/linux-check-pixels.py', file, String(width), String(height)]))
  const [tree, retained, painted] = await Promise.all([
    app.call('getTree', {}), app.call('getAllText', {}), app.call('getPaintedText', {}),
  ])
  const record = { name, width, height, pid, windowId, capture: 'X11 pixels from the live native window',
    pixels, tree: tree.tree, retainedText: retained.text, paintedText: painted.text }
  evidence.push(record)
  await writeFile(join(out, `${name}.json`), JSON.stringify(record, null, 2) + '\n')
  await saveEvidence()
}
async function saveEvidence() {
  await writeFile(join(out, 'evidence.json'), JSON.stringify({ schemaVersion: 1,
    sourceCommit: (await run(['git', 'rev-parse', 'HEAD'])), renderer: 'stock GPUIX 0.10.0 Linux x86-64 live X11 + Mesa software Vulkan',
    testRenderer: false, browser: false, hardware: 'none', visualInspection: 'required', evidence }, null, 2) + '\n')
}
async function click(app: App, testId: string) {
  await app.getByTestId(testId).waitFor({ timeoutMs: 10_000 })
  const bounds = await app.getByTestId(testId).bounds()
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1180 || bounds.y + bounds.height > 780
    || bounds.width <= 0 || bounds.height <= 0) throw new Error(`Native control outside viewport: ${testId}`)
  await app.getByTestId(testId).click()
  await Bun.sleep(80)
}
async function hasText(app: App, text: string) {
  await waitFor(async () => (await app.call('getAllText', {})).text.includes(text), text)
}

// Prove the syscall sensor detects forbidden classes using only synthetic
// loopback traffic and an ordinary temporary file, before trusting clean traces.
await run([process.execPath, 'packaging/runtime-sensor.ts', join(root, 'artifacts/runtime/sensor')])

// First establish the compiled worker boundary separately: the GUI demo never
// needs to start a worker. The trace wrapper verifies hashes and exact child exec.
const bootstrap = await startRuntimeTrace({ packageDirectory, evidenceDirectory: join(root, 'artifacts/runtime/bootstrap'),
  env: process.env, args: ['--package-self-test'], phase: 'bootstrap' })
const bootstrapOutput = await within(new Response(bootstrap.child.stdout).text(), 'compiled worker handshake')
const bootstrapReport = await within(bootstrap.finish(), 'bootstrap runtime evidence')
if (!bootstrapOutput.includes('"hardwareAccess":false')) throw new Error('Compiled handshake did not deny hardware access')
await writeFile(join(out, 'bootstrap.json'), JSON.stringify({ output: bootstrapOutput, report: bootstrapReport }, null, 2) + '\n')

const traced = await startRuntimeTrace({ packageDirectory, evidenceDirectory: join(root, 'artifacts/runtime/demo'), env: process.env, phase: 'demo' })
let app: App | undefined
try {
  app = await connect(traced.child, traced.stop)
  await capture(app, 'installed-disconnected', 1180, 780)
  await click(app, 'open-demo')
  await click(app, 'key-caps-lock')
  await click(app, 'target-input')
  const input = await app.getByTestId('target-input').element()
  await app.call('keystrokes', { elementId: input.id, keys: 'e s c a p e' })
  await click(app, 'target-key.escape')
  await click(app, 'stage-change')
  await hasText(app, '1 pending change')
  await capture(app, 'installed-staged', 1180, 780)
  await click(app, 'review-changes')
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await capture(app, 'installed-review', 1180, 780)
  await app.call('keystrokes', { keys: 'escape' })
  await waitFor(async () => (await app!.getByTestId('cancel-review').count()) === 0, 'Escape dismisses review')
  // Enter without refocusing must reopen review, demonstrating focus return.
  await app.call('keystrokes', { keys: 'enter' })
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await click(app, 'simulate-apply')
  await hasText(app, 'Simulated changes verified')
  await capture(app, 'installed-verified', 1180, 780)
  evidence.push({ name: 'installed-interaction', result: 'passed', input: 'stock live GPUI dispatch and hit testing',
    flow: ['open demo', 'select Caps', 'search Escape', 'choose target', 'stage', 'review', 'Escape closes',
      'Enter reopens through restored focus', 'simulate', 'verified'], physicalKeyboard: false })
} finally {
  if (app) await app.close()
  else traced.stop()
  await within(traced.finish(), 'compiled GUI runtime evidence')
  await saveEvidence()
}

const scenarios = ['disconnected', 'read-only', 'editing', 'review', 'applying', 'verified', 'uncertain'] as const
const fixtures = [
  ...(['1180x780', '960x680'] as const).flatMap(dimensions => (['light', 'dark'] as const).flatMap(appearance =>
    scenarios.map(scenario => ({ dimensions, appearance, scenario, composition: 'board-and-inspector' })))),
  { dimensions: '1180x780', appearance: 'light', scenario: 'editing', composition: 'stacked-workbench' },
]
for (const fixture of fixtures) {
  const name = `${fixture.scenario}-${fixture.appearance}-${fixture.dimensions}-${fixture.composition}`
  const [width, height] = fixture.dimensions.split('x').map(Number) as [number, number]
  const child = Bun.spawn([process.execPath, 'packaging/linux-fixture.ts', fixture.scenario, fixture.appearance,
    fixture.dimensions, fixture.composition], { cwd: root, env: process.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const stderr = new Response(child.stderr).text().then(text => writeFile(join(out, `${name}.stderr.txt`), text))
  let fixtureApp: App | undefined
  try {
    fixtureApp = await connect(child, () => child.kill())
    await capture(fixtureApp, name, width, height)
  } finally {
    if (fixtureApp) await fixtureApp.close()
    child.kill()
    await within(Promise.all([child.exited, stderr]), 'native fixture shutdown')
  }
}
await saveEvidence()
console.log('Compiled native flow and 29 live Linux fixture captures completed. Pixel review is still required; no HID was opened.')
