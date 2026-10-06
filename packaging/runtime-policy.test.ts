import { describe, expect, test } from 'bun:test'
import { analyzeRuntimeTrace, summarizeRuntimeStderr } from './runtime-policy'

const options = {packageDirectory:'/test/Installed Jazzkeys',initialCwd:'/test/Installed Jazzkeys',phase:'demo' as const}
const head = '1.000000 execve("/test/Installed Jazzkeys/jazzkeys", ["jazzkeys"], 0x0 /* 0 vars */) = 0\n1.000001 openat(AT_FDCWD, "/lib/libc.so.6", O_RDONLY|O_CLOEXEC) = 3</lib/libc.so.6>\n'
const analyze = (lines:string,phase:'demo'|'bootstrap'='demo') => analyzeRuntimeTrace([{name:'syscalls.100',text:head+lines}],{...options,phase})
const categories = (lines:string) => analyze(lines).findings.map(item=>item.category)

describe('runtime syscall acceptance, independent of app source',()=>{
  test('allows normal font/library reads and local X11/session sockets',()=>{
    const result = analyze('1.1 openat(AT_FDCWD, "/etc/fonts/fonts.conf", O_RDONLY) = 4</etc/fonts/fonts.conf>\n1.2 socket(AF_UNIX, SOCK_STREAM|SOCK_CLOEXEC, 0) = 5<UNIX-STREAM:[1]>\n1.3 connect(5<UNIX-STREAM:[1]>, {sa_family=AF_UNIX, sun_path="/tmp/.X11-unix/X97"}, 21) = 0\n')
    expect(result.passed).toBe(true)
    expect(result.unixConnections).toEqual(['/tmp/.X11-unix/X97'])
    expect(result.internetAttempts).toBe(0)
  })
  test.each(['AF_INET','AF_INET6'])('rejects attempted %s networking even when blocked',family=>{
    expect(categories(`1.1 socket(${family}, SOCK_STREAM, IPPROTO_TCP) = -1 EPERM (Operation not permitted)\n`)).toContain('internet-network-attempt')
    expect(categories(`1.2 connect(5, {sa_family=${family}, sin_port=htons(443)}, 16) = -1 ENETUNREACH (Network is unreachable)\n`)).toContain('internet-network-attempt')
  })
  test('rejects other remote socket families, but reports kernel-local netlink separately',()=>{
    expect(categories('1.1 socket(AF_VSOCK, SOCK_STREAM, 0) = -1 EPERM\n')).toContain('unexpected-socket-family')
    const netlink = analyze('1.1 socket(AF_NETLINK, SOCK_RAW|SOCK_CLOEXEC, NETLINK_ROUTE) = 5\n')
    expect(netlink.passed).toBe(true)
    expect(netlink.netlinkSocketCalls).toBe(1)
  })
  test.each(['/dev/hidraw0','/dev/input/event3','/dev/uinput','/dev/bus/usb/001/002','/dev/usb/hiddev0'])('rejects a failed device open: %s',path=>{
    expect(categories(`1.1 openat(AT_FDCWD, "${path}", O_RDWR|O_CLOEXEC) = -1 EACCES\n`)).toContain('input-or-hid-device')
  })
  test('resolves openat dirfd and chdir-relative paths',()=>{
    expect(categories('1.1 openat(7</dev/input>, "event2", O_RDONLY) = -1 ENOENT\n')).toContain('input-or-hid-device')
    expect(categories('1.1 chdir("/dev/input") = 0\n1.2 openat(AT_FDCWD, "event2", O_RDONLY) = -1 ENOENT\n')).toContain('input-or-hid-device')
  })
  test('inherits shared cwd changes across threads',()=>{
    const result=analyzeRuntimeTrace([
      {name:'syscalls.100',text:head+'1.1 clone(child_stack=NULL, flags=CLONE_VM|CLONE_FS|CLONE_THREAD) = 101\n1.3 openat(AT_FDCWD, "event2", O_RDONLY) = -1 ENOENT\n'},
      {name:'syscalls.101',text:'1.2 chdir("/dev/input") = 0\n'},
    ],options)
    expect(result.findings.map(item=>item.category)).toContain('input-or-hid-device')
  })
  test('does not discard blocked or interrupted dangerous syscalls',()=>{
    expect(categories('1.1 connect(5, {sa_family=AF_INET, sin_port=htons(80)}, 16 <unfinished ...>\n1.2 <... connect resumed>) = -1 ENETUNREACH\n')).toContain('internet-network-attempt')
    expect(categories('1.1 openat(AT_FDCWD, "/dev/hidraw0", O_RDWR <unfinished ...>\n')).toContain('input-or-hid-device')
  })
  test('rejects HID/input ioctls including on an identified descriptor',()=>{
    expect(categories('1.1 ioctl(4</dev/hidraw0>, HIDIOCGRAWINFO, 0x0) = -1 EINVAL\n')).toContain('input-or-hid-ioctl')
    expect(categories('1.1 ioctl(4</tmp/synthetic>, EVIOCGVERSION, 0x0) = -1 ENOTTY\n')).toContain('input-or-hid-ioctl')
  })
  test('rejects attempted system service writes, home autostart and grants',()=>{
    expect(categories('1.1 openat(AT_FDCWD, "/etc/udev/rules.d/99-keyboard.rules", O_WRONLY|O_CREAT, 0644) = -1 EACCES\n')).toContain('system-or-startup-file-write')
    expect(categories('1.1 mkdir("/home/test/.config/systemd/user", 0700) = -1 EACCES\n')).toContain('system-or-startup-file-mutation')
    expect(categories('1.1 chmod("/tmp/synthetic-missing", 04777) = -1 ENOENT\n')).toContain('unsafe-permission-grant')
    expect(categories('1.1 setxattr("/tmp/synthetic", "security.capability", "", 0, 0) = -1 EPERM\n')).toContain('unsafe-permission-grant')
    expect(analyze('1.1 chmod("/tmp/private-cache", 0700) = 0\n').passed).toBe(true)
  })
  test.each(['setuid(0)','capset(NULL, NULL)','unshare(CLONE_NEWNET)','setsid()','io_uring_setup(8, NULL)'])('rejects privilege or unobserved async access: %s',call=>{
    expect(categories(`1.1 ${call} = -1 EPERM\n`)).toContain('namespace-or-privilege')
  })
  test('requires exact bootstrap worker and rejects any helper attempt in GUI',()=>{
    const worker='1.1 execve("/test/Installed Jazzkeys/jazzkeys-device", ["jazzkeys-device"], 0x0 /* 0 vars */) = 0\n'
    expect(analyze(worker,'bootstrap').passed).toBe(true)
    expect(analyze('','bootstrap').passed).toBe(false)
    expect(analyze(worker).passed).toBe(false)
    expect(categories('1.1 execve("/usr/bin/pkexec", ["pkexec"], 0x0) = -1 ENOENT\n')).toContain('unexpected-executable')
  })
  test('rejects even a non-exec daemon fork in GUI mode',()=>{
    expect(categories('1.1 clone(child_stack=NULL, flags=SIGCHLD) = 101\n')).toContain('unexpected-child-process')
  })
  test('rejects empty, malformed and non-executed traces',()=>{
    expect(analyzeRuntimeTrace([],options).passed).toBe(false)
    expect(categories('strace: ptrace(PTRACE_TRACEME): Operation not permitted\n')).toContain('unparsed-trace')
    expect(categories('1.1 <... connect resumed>) = 0\n')).toContain('incomplete-trace')
  })
})

test('startup diagnostics never copy stderr paths, credentials or user data',()=>{
  const diagnostic = summarizeRuntimeStderr('VK_ERROR_INCOMPATIBLE_DRIVER: failed GPU adapter at /home/private-person/secret.txt cookie=deadbeefbadcafeabc123456789abcde\nPTRACE_TRACEME: Operation not permitted')
  expect(diagnostic.categories).toEqual(['ptraceDenied','vulkan','gpuAdapter'])
  expect(diagnostic.vulkanCodes).toEqual(['VK_ERROR_INCOMPATIBLE_DRIVER'])
  expect(JSON.stringify(diagnostic)).not.toContain('private-person')
  expect(JSON.stringify(diagnostic)).not.toContain('deadbeef')
})
