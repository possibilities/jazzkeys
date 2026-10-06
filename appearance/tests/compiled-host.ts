/* Compiled test entry; no renderer imports or native window. */
import { createSystemAppearanceSource } from '../../app/client/system-appearance'
let spawnAttempts = 0
if (process.argv.includes('--assert-no-helper-exec')) {
  // Test-only trap: unsafe-mode regressions can never execute a privileged file,
  // even if the production preflight check regresses.
  Bun.spawn = (() => { spawnAttempts++; throw new Error('Unexpected helper execution') }) as typeof Bun.spawn
}
const source = await createSystemAppearanceSource()
if (spawnAttempts !== 0) throw new Error('Unsafe helper reached process creation')
console.log(JSON.stringify(source.getSnapshot()))
source.dispose()
