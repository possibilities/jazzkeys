import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

declare const JAZZKEYS_WORKER_SHA256: string
const MAX_FRAME = 65_536
const EXPECTED_VERSION = '0.1.0'

/** No caller-supplied path, shell command, HID buffer, or opcode surface. */
export async function checkPackagedWorker(): Promise<{mode: 'no_hardware'; hardwareAccess: false}> {
  if (typeof JAZZKEYS_WORKER_SHA256 === 'undefined' || !/^[a-f0-9]{64}$/.test(JAZZKEYS_WORKER_SHA256)) {
    throw new Error('Worker integrity is available only in a compiled Jazzkeys package')
  }
  const directory = await realpath(dirname(process.execPath))
  const path = join(directory, 'jazzkeys-device')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || await realpath(path) !== path) {
    throw new Error('Packaged worker has unsafe type, location, or permissions')
  }
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== JAZZKEYS_WORKER_SHA256) {
    throw new Error('Packaged worker integrity mismatch; nothing was started')
  }
  const child = Bun.spawn([path], {cwd: directory, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: {}})
  let expired = false
  const watchdog = setTimeout(() => { expired = true; child.kill('SIGKILL') }, 5_000)
  try {
    child.stdin.write(JSON.stringify({v:1,id:'package-hello',command:{type:'hello'}}) + '\n')
    child.stdin.end()
    const readBounded = async (stream: ReadableStream<Uint8Array>, maximum: number): Promise<string> => {
      const reader = stream.getReader()
      let size = 0
      const chunks: Uint8Array[] = []
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > maximum) { child.kill('SIGKILL'); throw new Error('Worker exceeded pipe limit') }
        chunks.push(next.value)
      }
      return Buffer.concat(chunks).toString('utf8')
    }
    const [output] = await Promise.all([readBounded(child.stdout, MAX_FRAME), readBounded(child.stderr, 16_384)])
    const code = await child.exited
    if (expired || code !== 0) throw new Error('Worker handshake timed out or failed; no replay was attempted')
    const lines = output.trim().split('\n')
    if (lines.length !== 1) throw new Error('Unexpected worker receipt count')
    const result = JSON.parse(lines[0]!)
    if (result.v !== 1 || result.id !== 'package-hello' || result.ok !== true || result.result?.type !== 'hello' ||
      result.result.workerVersion !== EXPECTED_VERSION || result.result.protocolVersion !== 1 ||
      result.result.mode !== 'no_hardware' || result.result.hardwareAccess !== false || result.result.maxFrameBytes !== MAX_FRAME) {
      throw new Error('Worker identity or protocol mismatch')
    }
    return {mode:'no_hardware',hardwareAccess:false}
  } finally {
    clearTimeout(watchdog)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}
