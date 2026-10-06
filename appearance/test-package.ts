import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// A tiny first-party fixture speaks the same pipe format. It does not read an OS preference.
const directory = await mkdtemp(join(tmpdir(), 'jazzkeys-appearance-package-'))
try {
  const helper = join(directory, 'jazzkeys-appearance')
  const app = join(directory, 'host')
  const source = join(directory, 'fixture.c')
  await writeFile(source, '#include <stdio.h>\n#include <unistd.h>\nint main(void) { puts("{\\"v\\":1,\\"appearance\\":\\"dark\\",\\"availability\\":\\"live\\"}"); fflush(stdout); char byte; while(read(0,&byte,1)>0){} return 0; }\n')
  const compiler = Bun.spawn(['cc', '-O2', source, '-o', helper], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await compiler.exited, 0)
  const hash = createHash('sha256').update(await readFile(helper)).digest('hex')
  const build = Bun.spawn([process.execPath, 'build', '--compile', resolve(import.meta.dir, 'tests/compiled-host.ts'), '--outfile', app,
    '--define', `JAZZKEYS_APPEARANCE_SHA256=${JSON.stringify(hash)}`], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await build.exited, 0)
  const run = async (assertNoHelperExec = false) => {
    // The fixture never connects to this path; the host only checks an allowed transport exists.
    const child = Bun.spawn([app, ...(assertNoHelperExec ? ['--assert-no-helper-exec'] : [])], { cwd: '/', env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/jazzkeys-test-bus' }, stdout: 'pipe', stderr: 'inherit' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try {
      const output = await new Response(child.stdout).text()
      assert.equal(await child.exited, 0, 'Packaged observer must terminate promptly')
      return JSON.parse(output)
    } finally { clearTimeout(timer) }
  }
  const fallback = { appearance: null, availability: 'unavailable' }
  assert.deepEqual(await run(), { appearance: 'dark', availability: 'live' })
  for (const mode of [0o777, 0o4755, 0o2755]) {
    // Bun 1.3.10's chmod masks special bits. Use the platform utility and assert
    // the fixture mode, while the compiled host traps every attempted spawn.
    assert.equal(Bun.spawnSync(['/bin/chmod', mode.toString(8), helper]).exitCode, 0)
    assert.equal((await lstat(helper)).mode & 0o7777, mode)
    assert.deepEqual(await run(true), fallback, `Unsafe mode ${mode.toString(8)} must be refused before process creation`)
  }
  await chmod(helper, 0o755)
  const backup = join(directory, 'original-helper'); await copyFile(helper, backup)
  await writeFile(helper, '#!/bin/sh\nexit 1\n'); assert.deepEqual(await run(), fallback)
  await rm(helper); await symlink(backup, helper); assert.deepEqual(await run(), fallback)
  await rm(helper); assert.deepEqual(await run(), fallback)
  console.log('Compiled appearance host: fixed app-relative helper, exact hash, unsafe/setuid/setgid modes refused before process creation, altered/missing binary, symlink refusal, and prompt disposal passed')
} finally { await rm(directory, { recursive: true, force: true }) }
