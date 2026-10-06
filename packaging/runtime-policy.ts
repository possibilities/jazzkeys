import { posix } from 'node:path'

/** A bounded Linux strace acceptance policy, not a sandbox or a proof for all flows. */
export const runtimeTraceFilter = '%network,%file,%process,%creds,ioctl,prctl,capset,mount,umount2,unshare,setns,setsid,io_uring_setup,io_uring_enter,io_uring_register,bpf,ptrace'
// Do not print X11/DBus payloads or authentication data. Socket creation and
// connect/bind addresses remain decoded; send/receive buffers are pointer-only.
export const runtimeRawNetworkCalls = 'sendto,sendmsg,sendmmsg,recvfrom,recvmsg,recvmmsg'
export type TraceFile = { name: string; text: string }
export type RuntimePolicyOptions = { packageDirectory: string; initialCwd: string; phase: 'bootstrap' | 'demo'; appearanceHelperSha256?: string }
type Event = { pid: string; timestamp: number; syscall: string; text: string }
export type BoundaryFinding = { category: string; process: string; syscall: string; evidence: string }
const device = /(?:^|\/)(?:hidraw\d*|hiddev\d*|uinput)(?:$|\/)|^\/dev\/input(?:$|\/)|^\/dev\/bus\/usb(?:$|\/)|^\/dev\/usb\/hiddev/
const servicePath = /^\/(?:etc|usr|opt)(?:$|\/)|^\/(?:run|var\/lib)\/(?:systemd|udev)(?:$|\/)|\/(?:\.config|\.local\/share)\/(?:systemd|autostart)(?:$|\/)/
const mutation = /^(?:creat|mkdir|mkdirat|rmdir|unlink|unlinkat|rename|renameat|renameat2|link|linkat|symlink|symlinkat|mknod|mknodat|truncate|ftruncate|chmod|fchmod|fchmodat|fchmodat2|chown|fchown|lchown|fchownat|setxattr|lsetxattr|fsetxattr|removexattr|lremovexattr|fremovexattr)$/
const privileged = /^(?:setuid|setgid|setreuid|setregid|setresuid|setresgid|setfsuid|setfsgid|setgroups|capset|mount|umount2|unshare|setns|setsid|mknod|mknodat|chown|fchown|lchown|fchownat|bpf|ptrace|io_uring_setup|io_uring_enter|io_uring_register)$/

function strings(text: string): string[] {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1]!.replace(/\\(?:x([a-fA-F0-9]{2})|([0-7]{1,3})|([\\"nrtbfv]))/g, (_, hex, octal, escape) => {
    if (hex) return String.fromCharCode(parseInt(hex, 16))
    if (octal) return String.fromCharCode(parseInt(octal, 8))
    return ({'\\':'\\','"':'"',n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v'} as Record<string,string>)[escape]!
  }))
}

export function analyzeRuntimeTrace(files: TraceFile[], options: RuntimePolicyOptions) {
  const findings: BoundaryFinding[] = []
  const events: Event[] = []
  const add = (category: string, event: Event, evidence = event.text) => findings.push({category,process:event.pid,syscall:event.syscall,evidence:evidence.slice(0,8192)})
  for (const file of files) {
    const pid = file.name.match(/\.(\d+)$/)?.[1] ?? file.name
    let pending: string | undefined
    for (const raw of file.text.split('\n')) {
      let line = raw.trim()
      if (!line) continue
      const timestamp = Number(line.match(/^([0-9]+\.[0-9]+) /)?.[1] ?? 0)
      line = line.replace(/^[0-9]+\.[0-9]+ /, '')
      if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
      if (line.includes('<unfinished ...>')) { pending = line.replace('<unfinished ...>', ''); continue }
      if (line.startsWith('<... ')) {
        if (!pending) { findings.push({category:'incomplete-trace',process:pid,syscall:'unknown',evidence:raw}); continue }
        line = pending + line.replace(/^<\.\.\. \w+ resumed>/, '')
        pending = undefined
      }
      const syscall = line.match(/^(\w+)\(/)?.[1]
      if (!syscall) { findings.push({category:'unparsed-trace',process:pid,syscall:'unknown',evidence:raw}); continue }
      events.push({pid,timestamp,syscall,text:line})
    }
    // Termination can interrupt a syscall. Inspect the attempted call, including its
    // arguments, rather than silently discarding it or pretending it succeeded.
    if (pending) {
      const syscall = pending.match(/^(\w+)\(/)?.[1]
      if (syscall) events.push({pid,timestamp:Number.MAX_SAFE_INTEGER,syscall,text:pending+' <interrupted-at-stop>'})
      else findings.push({category:'incomplete-trace',process:pid,syscall:'unknown',evidence:pending})
    }
  }
  events.sort((a,b) => a.timestamp-b.timestamp)
  const cwd = new Map<string,{path:string}>()
  const execs: {process:string;path:string;successful:boolean}[] = []
  const processGroups = new Map<string,string>()
  const processSpawns: {event:Event;owner:string;child?:string}[] = []
  const appearanceExpected = options.phase === 'demo' && /^[a-f0-9]{64}$/.test(options.appearanceHelperSha256 ?? '')
  const appearancePath = posix.join(options.packageDirectory,'jazzkeys-appearance')
  if (options.appearanceHelperSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.appearanceHelperSha256)) findings.push({category:'appearance-integrity-configuration',process:'all',syscall:'execve',evidence:'Expected a verified SHA-256 for the fixed adjacent appearance helper'})
  const unixConnections = new Set<string>()
  let internetAttempts = 0, deviceAttempts = 0, opens = 0, unixSocketCalls = 0, netlinkSocketCalls = 0
  for (const event of events) {
    const {pid,syscall,text} = event
    const state = cwd.get(pid) ?? {path:options.initialCwd}
    cwd.set(pid,state)
    const quoted = strings(text)
    const fdPaths = [...text.matchAll(/(?:AT_FDCWD|\d+)<(\/[^>]*)>/g)].map(match => match[1]!)
    const base = text.match(/^\w+\((?:AT_FDCWD|\d+)<(\/[^>]*)>,/)?.[1] ?? state.path
    const paths = quoted.map(path => path.startsWith('/') ? posix.normalize(path) : posix.resolve(base,path))
    const successful = / = (?:0|[1-9]\d*)(?:\b|<)/.test(text)
    if (/^(?:clone|clone3|fork|vfork)$/.test(syscall)) {
      const child = text.match(/ = (\d+)\s*$/)?.[1]
      if (child) {
        cwd.set(child,text.includes('CLONE_FS') ? state : {path:state.path})
        processGroups.set(child,text.includes('CLONE_THREAD') ? pid : child)
      }
      if (/CLONE_NEW\w+/.test(text)) add('namespace-or-privilege',event)
      if (/\bCLONE_UNTRACED\b/.test(text)) add('trace-evasion',event)
      if (/\bCLONE_PARENT\b/.test(text)) add('detached-process-parent',event)
      if (options.phase === 'demo' && !text.includes('CLONE_THREAD')) processSpawns.push({event,owner:processGroups.get(pid) ?? pid,child})
    }
    if (syscall === 'chdir' && successful && paths[0]) state.path = paths[0]
    if (syscall === 'fchdir' && successful) {
      if (fdPaths[0]) state.path = fdPaths[0]
      else add('unresolved-directory',event)
    }
    if (syscall === 'execve' || syscall === 'execveat') {
      const path = quoted[0] ? paths[0]! : fdPaths[0]
      if (!path) add('unresolved-executable',event)
      else {
        execs.push({process:pid,path,successful})
        const allowed = path === posix.join(options.packageDirectory,'jazzkeys') ||
          (options.phase === 'bootstrap' && path === posix.join(options.packageDirectory,'jazzkeys-device')) ||
          (appearanceExpected && path === appearancePath)
        if (!allowed) add('unexpected-executable',event)
        if (path === appearancePath && (quoted.length !== 2 || quoted[1] !== appearancePath)) add('appearance-helper-arguments',event)
      }
    }
    if (/^(?:socket|socketpair)$/.test(syscall)) {
      const domain = text.match(/^\w+\((AF_\w+)/)?.[1]
      if (domain === 'AF_UNIX' || domain === 'AF_LOCAL') unixSocketCalls++
      else if (domain === 'AF_NETLINK') netlinkSocketCalls++
      else if (!domain || !/^AF_INET6?$/.test(domain)) add('unexpected-socket-family',event)
    }
    if (/\bAF_INET6?\b|<(?:TCP|UDP|RAW)(?:v6)?:/.test(text) && /^(?:socket|socketpair|connect|bind|listen|accept|accept4|sendto|sendmsg|sendmmsg|recvfrom|recvmsg|recvmmsg|getpeername|getsockname)$/.test(syscall)) {
      internetAttempts++
      add('internet-network-attempt',event)
    }
    if (syscall === 'connect' && /AF_UNIX|AF_LOCAL/.test(text)) unixConnections.add(quoted[0] ?? '(unnamed Unix socket)')
    if (/^(?:open|openat|openat2|creat)$/.test(syscall)) {
      opens++
      if ([paths[0],...fdPaths].some(path => path && device.test(path))) { deviceAttempts++; add('input-or-hid-device',event) }
      if (paths[0] && servicePath.test(paths[0]) && /\b(?:O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_TMPFILE)\b/.test(text)) add('system-or-startup-file-write',event)
      if (/"\.\.\./.test(text)) add('truncated-path',event)
    }
    if (syscall === 'ioctl' && (fdPaths.some(path => device.test(path)) || /\b(?:HIDIO\w*|EVIOC\w*|UI_DEV\w*)\b/.test(text))) { deviceAttempts++; add('input-or-hid-ioctl',event) }
    if (mutation.test(syscall) && [...paths,...fdPaths].some(path => servicePath.test(path))) add('system-or-startup-file-mutation',event)
    if (/^(?:chmod|fchmod|fchmodat|fchmodat2)$/.test(syscall)) {
      const modes = [...text.matchAll(/(?:, |\()0([0-7]{3,6})(?=[,)])/g)].map(match => parseInt(match[1]!,8))
      if (modes.some(mode => (mode & 0o6002) !== 0)) add('unsafe-permission-grant',event)
    }
    if (/^(?:setxattr|lsetxattr|fsetxattr)$/.test(syscall) && quoted.includes('security.capability')) add('unsafe-permission-grant',event)
    if (privileged.test(syscall)) add('namespace-or-privilege',event)
    if (syscall === 'prctl' && /PR_SET_(?:KEEPCAPS|SECUREBITS)|PR_CAP_AMBIENT/.test(text)) add('namespace-or-privilege',event)
  }
  const app = execs.filter(entry=>entry.path===posix.join(options.packageDirectory,'jazzkeys') && entry.successful)
  const workers = execs.filter(entry=>entry.path===posix.join(options.packageDirectory,'jazzkeys-device') && entry.successful)
  const appearanceExecs = execs.filter(entry=>entry.path===appearancePath)
  const appearance = appearanceExecs.filter(entry=>entry.successful)
  if (appearanceExecs.length !== (appearanceExpected ? 1 : 0) || appearance.length !== (appearanceExpected ? 1 : 0)) findings.push({category:'appearance-exec-count',process:'all',syscall:'execve',evidence:`Expected ${appearanceExpected ? 1 : 0} exact appearance helper launch, observed ${appearanceExecs.length} attempts/${appearance.length} successes`})
  // A child may execute before its parent's clone resumes in another trace file.
  // Resolve thread ownership after collecting all clone edges, not while parsing.
  for (const spawn of processSpawns) {
    let owner = spawn.event.pid
    const seen = new Set<string>()
    while (processGroups.has(owner) && processGroups.get(owner)! !== owner && !seen.has(owner)) {
      seen.add(owner); owner = processGroups.get(owner)!
    }
    spawn.owner = owner
  }
  const allowedAppearanceSpawns = processSpawns.filter(spawn=>appearanceExpected && appearance.length===1 && app.length===1 && spawn.owner===app[0]!.process && spawn.child===appearance[0]!.process)
  if (appearanceExpected && allowedAppearanceSpawns.length!==1) findings.push({category:'appearance-spawn-identity',process:'all',syscall:'clone',evidence:'Appearance helper must be the one directly spawned child of the app process'})
  let cloneFallbackUsed = false
  for (const spawn of processSpawns) {
    if (allowedAppearanceSpawns.includes(spawn)) continue
    // glibc posix_spawn may probe clone3 once before its clone fallback. Permit
    // only that exact unavailable-kernel probe paired to the verified child.
    const canonicalFallback = !cloneFallbackUsed && spawn.event.syscall==='clone3' && !spawn.child &&
      / = -1 ENOSYS\b/.test(spawn.event.text) && /CLONE_VM/.test(spawn.event.text) && /CLONE_VFORK/.test(spawn.event.text) &&
      allowedAppearanceSpawns.length===1 && allowedAppearanceSpawns[0]!.event.pid===spawn.event.pid &&
      allowedAppearanceSpawns[0]!.event.timestamp>spawn.event.timestamp
    if (canonicalFallback) cloneFallbackUsed = true
    else add('unexpected-child-process',spawn.event)
  }
  if (app.length !== 1) findings.push({category:'missing-or-repeated-app-exec',process:'all',syscall:'execve',evidence:`Expected one successful compiled app exec, observed ${app.length}`})
  if (workers.length !== (options.phase === 'bootstrap' ? 1 : 0)) findings.push({category:'worker-exec-count',process:'all',syscall:'execve',evidence:`Observed ${workers.length} worker launches in ${options.phase}`})
  if (opens === 0) findings.push({category:'missing-file-trace',process:'all',syscall:'openat',evidence:'No file opens captured; incomplete tracing cannot pass'})
  return {passed:findings.length===0,phase:options.phase,traceFiles:files.length,syscalls:events.length,fileOpens:opens,
    internetAttempts,deviceAttempts,unixSocketCalls,netlinkSocketCalls,unixConnections:[...unixConnections].sort(),execs,
    appearanceHelper:appearanceExpected ? {path:appearancePath,sha256:options.appearanceHelperSha256,successfulLaunches:appearance.length} : null,
    processSpawns:processSpawns.map(spawn=>({process:spawn.event.pid,owner:spawn.owner,child:spawn.child,syscall:spawn.event.syscall,evidence:spawn.event.text})),findings}
}

/** Fixed-vocabulary diagnostics only: never copy stderr paths, cookies or input. */
export function summarizeRuntimeStderr(stderr: string) {
  const patterns: Record<string,RegExp> = {
    ptraceDenied: /PTRACE_\w+|ptrace|Operation not permitted/i,
    vulkan: /vulkan|VK_ERROR_\w+|vkCreate\w+/i,
    gpuAdapter: /\b(?:wgpu|GPU|adapter|renderer)\b/i,
    nativeBindingMissing: /Cannot find native binding/i,
    moduleMissing: /Cannot find (?:module|package)|ModuleNotFound|MODULE_NOT_FOUND/i,
    nativeAbiOrLinker: /ERR_DLOPEN_FAILED|undefined symbol|NODE_MODULE_VERSION|GLIBC_[0-9]|NAPI[^a-z]/i,
    display: /X11|xcb|XOpenDisplay|DISPLAY|Wayland|display server/i,
    font: /fontconfig|font|FreeType/i,
    sessionBus: /DBus|D-Bus|session bus/i,
    runtimeDirectory: /XDG_RUNTIME_DIR/i,
    permissionDenied: /permission denied|EACCES|EPERM/i,
    missingFileOrLibrary: /No such file|cannot open shared object|ENOENT|failed to load/i,
    panic: /panicked|panic|unwrap\(\)|stack trace/i,
    brokenPipe: /broken pipe|EPIPE/i,
  }
  return {bytes:Buffer.byteLength(stderr),categories:Object.entries(patterns).filter(([,pattern])=>pattern.test(stderr)).map(([category])=>category),
    vulkanCodes:[...new Set(stderr.match(/\bVK_ERROR_[A-Z0-9_]+\b/g) ?? [])].slice(0,12),
    missingKnownAssets:['@gpuix/native-linux-x64-gnu','@gpuix/native-darwin-arm64','gpuix-native.linux-x64-gnu.node','gpuix-native.darwin-arm64.node'].filter(asset=>stderr.includes(`Cannot find module '${asset}'`) || stderr.includes(`Cannot find module './${asset}'`)),
    note:'Fixed-vocabulary classification only; raw stderr stays in the disposable test directory'}
}

/** An intentional stop must not turn an earlier crash into successful evidence. */
export function runtimeExitAccepted(phase: 'bootstrap'|'demo', exitCode: number, intentionallyStopped: boolean): boolean {
  return exitCode === 0 || (phase === 'demo' && intentionallyStopped && exitCode === 143)
}
