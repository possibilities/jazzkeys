import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { release } from 'node:os'
import { analyzeRuntimeTrace, runtimeTraceFilter, runtimeRawNetworkCalls, summarizeRuntimeStderr } from './runtime-policy'
import { verifyPackage } from './verify-package'

export type RuntimeTraceOptions = {
  packageDirectory: string
  evidenceDirectory: string
  env: Record<string,string | undefined>
  args?: string[]
  phase?: 'bootstrap' | 'demo'
  timeoutMs?: number
}

/** Launch only inside an authorized isolated test session. Raw evidence is synthetic-only. */
export async function startRuntimeTrace(options: RuntimeTraceOptions) {
  if (process.platform !== 'linux') throw new Error('Runtime syscall acceptance currently requires Linux strace')
  if (process.getuid?.() === 0) throw new Error('Runtime acceptance must run as an ordinary user, not root')
  const packageDirectory = await realpath(resolve(options.packageDirectory))
  const evidenceDirectory = resolve(options.evidenceDirectory)
  const phase = options.phase ?? 'demo'
  const args = options.args ?? (phase === 'bootstrap' ? ['--package-self-test'] : [])
  if (JSON.stringify(args) !== JSON.stringify(phase === 'bootstrap' ? ['--package-self-test'] : [])) throw new Error('Only bounded production demo/bootstrap invocations are accepted')
  const before = await verifyPackage(packageDirectory)
  const executableModes: Record<string,string> = {}
  for (const name of ['jazzkeys','jazzkeys-device']) {
    const mode = (await stat(join(packageDirectory,name))).mode & 0o7777
    if ((mode & 0o6022) !== 0 || (mode & 0o100) === 0) throw new Error(`Unsafe package executable mode: ${name}`)
    executableModes[name] = mode.toString(8)
  }
  const networkNamespace = await readlink('/proc/self/ns/net')
  const networkDevices = await readFile('/proc/net/dev','utf8')
  const networkRoutes = await readFile('/proc/net/route','utf8')
  const networkInterfaces = networkDevices.split('\n').slice(2).map(line=>line.split(':')[0]?.trim()).filter(Boolean)
  const isolated = options.env.JAZZKEYS_NETWORK_NAMESPACE === '1' &&
    !!options.env.JAZZKEYS_BASE_NETWORK_NS && networkNamespace !== options.env.JAZZKEYS_BASE_NETWORK_NS &&
    networkInterfaces.length === 1 && networkInterfaces[0] === 'lo' && networkRoutes.trim().split('\n').length === 1
  if (!isolated) throw new Error('Runtime acceptance requires a verified loopback-only network namespace distinct from the host namespace')
  if (before.target !== 'linux-x64-gnu') throw new Error('Expected a Linux compiled package')
  await mkdir(evidenceDirectory,{recursive:true,mode:0o700})
  if ((await readdir(evidenceDirectory)).length) throw new Error('Use a fresh evidence directory to avoid mixing runtime traces')
  const version = Bun.spawnSync(['strace','--version'],{stdout:'pipe',stderr:'pipe'})
  const help = Bun.spawnSync(['strace','--help'],{stdout:'pipe',stderr:'pipe'})
  if (version.exitCode !== 0 || !help.stdout.toString().includes('--kill-on-exit')) throw new Error('strace >=6.6 with --kill-on-exit is required')
  const traceArgs = ['-ff','-q','-ttt','-yy','-s','8192','-I','1','--kill-on-exit','-e',`trace=${runtimeTraceFilter}`,
    '-e',`raw=${runtimeRawNetworkCalls}`,'-o',join(evidenceDirectory,'syscalls'),join(packageDirectory,'jazzkeys'),...args]
  // Start with empty PATH so the tested executable cannot rely on system Bun/Node.
  // strace itself is resolved by the harness, before constructing the child env.
  const strace = Bun.which('strace')!
  const startedAt = new Date().toISOString()
  const child = Bun.spawn([strace,...traceArgs],{cwd:packageDirectory,env:{...options.env,PATH:''},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
  let stopped = false, expired = false
  const stop = () => { if (child.exitCode === null) { stopped = true; child.kill('SIGTERM') } }
  const watchdog = setTimeout(()=>{expired=true;stop()},options.timeoutMs ?? 120_000)
  // Never copy stdout: it belongs exclusively to the stock GPUIX stdio protocol.
  const stderr = new Response(child.stderr).text().then(async text=>{
    await writeFile(join(evidenceDirectory,'stderr.txt'),text,{mode:0o600})
    return text
  })
  const finish = async () => {
    const exitCode = await child.exited
    clearTimeout(watchdog)
    const errors = await stderr
    const traces = await Promise.all((await readdir(evidenceDirectory)).filter(name=>/^syscalls\.\d+$/.test(name)).sort().map(async name=>({name,text:await readFile(join(evidenceDirectory,name),'utf8')})))
    const policy = analyzeRuntimeTrace(traces,{packageDirectory,initialCwd:packageDirectory,phase})
    let packageUnchanged = false
    let packageVerificationError: string | undefined
    try {
      const after = await verifyPackage(packageDirectory)
      const modesAfter = await Promise.all(Object.keys(executableModes).map(async name=>
        ((await stat(join(packageDirectory,name))).mode & 0o7777).toString(8) === executableModes[name]))
      packageUnchanged = JSON.stringify(before)===JSON.stringify(after) && modesAfter.every(Boolean)
    } catch (error) { packageVerificationError = String(error) }
    const ptraceFailure = /Operation not permitted|PTRACE_\w+.*(?:denied|failed)|strace:.*(?:error|failed)/i.test(errors)
    const passed = policy.passed && packageUnchanged && !expired && !ptraceFailure && (phase==='bootstrap' ? exitCode===0 : stopped || exitCode===0)
    const report = {schemaVersion:1,passed,scope:'compiled no-hardware demo; observed Linux app descendants only',startedAt,finishedAt:new Date().toISOString(),
      uid:process.getuid?.(),kernel:release(),strace:version.stdout.toString().split('\n')[0],sourceCommit:before.sourceCommit,sourceTree:before.sourceTree,
      packageFiles:before.files,executableModes,packageUnchanged,packageVerificationError,networkIsolation:{isolated,networkNamespace,baseNetworkNamespace:options.env.JAZZKEYS_BASE_NETWORK_NS,networkInterfaces,networkRoutes},phase,traceFilter:runtimeTraceFilter,pointerOnlyNetworkCalls:runtimeRawNetworkCalls,exitCode,intentionallyStopped:stopped,timedOut:expired,ptraceFailure,startupDiagnostic:summarizeRuntimeStderr(errors),
      traceArtifacts:traces.map(file=>({name:file.name,sha256:createHash('sha256').update(file.text).digest('hex')})),policy,
      limits:['Finite synthetic flow, not every possible runtime path','Unix-domain services and normal font/library reads are observed separately from Internet traffic','This trace does not establish macOS permissions, accessibility acceptance, hardware safety, or installation behavior','No tracing of the user desktop, real keyboard input, clipboard, or private user files']}
    await writeFile(join(evidenceDirectory,'runtime-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
    if (!passed) throw new Error(`Runtime boundary acceptance failed; see ${join(evidenceDirectory,'runtime-report.json')}`)
    return report
  }
  return {child,stop,finish}
}

if (import.meta.main) {
  const [directory,evidence] = process.argv.slice(2)
  if (!directory || !evidence) throw new Error('Usage: bun packaging/runtime-trace.ts <package-directory> <fresh-evidence-directory> (bootstrap only)')
  const trace = await startRuntimeTrace({packageDirectory:directory,evidenceDirectory:evidence,env:process.env,phase:'bootstrap'})
  trace.child.stdin.end()
  const output = await new Response(trace.child.stdout).text()
  await trace.finish()
  if (!output.includes('"hardwareAccess":false')) throw new Error('Missing private-pipe no-hardware bootstrap receipt')
  console.log('Compiled bootstrap and exact sidecar traced; GUI/demo runtime acceptance remains separate.')
}
