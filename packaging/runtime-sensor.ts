import { mkdtemp, readFile, readdir, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { analyzeRuntimeTrace, runtimeTraceFilter, runtimeRawNetworkCalls, summarizeRuntimeStderr } from './runtime-policy'

// Deliberately violating regular-file/loopback-only probe. Run solely in the
// same isolated CI namespace as acceptance, never on a user desktop/device.
if (process.platform !== 'linux' || process.getuid?.() === 0 || process.env.JAZZKEYS_NETWORK_NAMESPACE !== '1') throw new Error('Sensor validation requires the isolated ordinary-user Linux harness')
const interfaces = (await readFile('/proc/net/dev','utf8')).split('\n').slice(2).map(line=>line.split(':')[0]?.trim()).filter(Boolean)
if (interfaces.length!==1 || interfaces[0]!=='lo') throw new Error('Sensor requires a loopback-only network namespace')
const evidence = resolve(process.argv[2] ?? 'artifacts/runtime-sensor')
await mkdir(evidence,{recursive:true,mode:0o700})
if ((await readdir(evidence)).length) throw new Error('Sensor evidence directory must be fresh')
const directory = await realpath(await mkdtemp(join(tmpdir(),'jazzkeys-runtime-sensor-')))
try {
  const source = join(directory,'probe.c')
  const executable = join(directory,'jazzkeys')
  const helper = Bun.which('true')
  if (!helper) throw new Error('Missing ordinary true executable for child tracing probe')
  await writeFile(source,`
#include <arpa/inet.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 2 || getuid() == 0) return 2;
  int v4 = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in a4 = {.sin_family=AF_INET, .sin_port=htons(9)};
  inet_pton(AF_INET, "127.0.0.1", &a4.sin_addr);
  if (v4 >= 0) { connect(v4, (void *)&a4, sizeof(a4)); close(v4); }
  int v6 = socket(AF_INET6, SOCK_STREAM, 0);
  struct sockaddr_in6 a6 = {.sin6_family=AF_INET6, .sin6_port=htons(9)};
  inet_pton(AF_INET6, "::1", &a6.sin6_addr);
  if (v6 >= 0) { connect(v6, (void *)&a6, sizeof(a6)); close(v6); }
  // This is a newly created regular file in our mkdtemp, never /dev hardware.
  int fake = open("hidraw0", O_RDWR|O_CREAT|O_EXCL, 0600);
  if (fake < 0) return 3;
  struct stat info;
  if (fstat(fake, &info) != 0 || !S_ISREG(info.st_mode)) return 4;
  int version = 0; ioctl(fake, EVIOCGVERSION, &version); close(fake);
  // The path does not exist: no actual permission is granted.
  if (chmod("missing-permission-probe", 04777) == 0) return 5;
  pid_t pid = fork();
  if (pid < 0) return 6;
  if (pid == 0) { execl(argv[1], argv[1], NULL); _exit(7); }
  int status = 0; if (waitpid(pid, &status, 0) < 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) return 8;
  return 0;
}
`)
  const compiler = Bun.spawnSync(['cc','-Wall','-Wextra','-Werror','-o',executable,source],{stdout:'pipe',stderr:'pipe'})
  if (compiler.exitCode!==0) throw new Error(`Sensor compile failed: ${compiler.stderr}`)
  const trace = Bun.spawn(['strace','-ff','-q','-ttt','-yy','-s','8192','-I','1','--kill-on-exit','-e',`trace=${runtimeTraceFilter}`,'-e',`raw=${runtimeRawNetworkCalls}`,'-o',join(evidence,'syscalls'),executable,helper],{cwd:directory,stdout:'pipe',stderr:'pipe'})
  const timer = setTimeout(()=>trace.kill('SIGTERM'),15_000)
  const [exitCode,stderr] = await Promise.all([trace.exited,new Response(trace.stderr).text()])
  clearTimeout(timer)
  await writeFile(join(evidence,'stderr.txt'),stderr)
  if (exitCode!==0) {
    await writeFile(join(evidence,'sensor-report.json'),JSON.stringify({schemaVersion:1,passed:false,exitCode,startupDiagnostic:summarizeRuntimeStderr(stderr)},null,2)+'\n')
    throw new Error(`Sensor trace failed with exit ${exitCode}; no runtime assurance is available`)
  }
  const files = await Promise.all((await readdir(evidence)).filter(name=>/^syscalls\.\d+$/.test(name)).map(async name=>({name,text:await readFile(join(evidence,name),'utf8')})))
  const policy = analyzeRuntimeTrace(files,{packageDirectory:directory,initialCwd:directory,phase:'demo'})
  const required = ['internet-network-attempt','input-or-hid-device','input-or-hid-ioctl','unsafe-permission-grant','unexpected-executable']
  const found = new Set(policy.findings.map(item=>item.category))
  const passed = required.every(category=>found.has(category)) && policy.execs.some(entry=>entry.path===helper && entry.successful)
  await writeFile(join(evidence,'sensor-report.json'),JSON.stringify({schemaVersion:1,passed,scope:'negative-control synthetic compiled probe, never application acceptance',required,policy},null,2)+'\n')
  if (!passed) throw new Error('Runtime sensor failed to detect a deliberately injected boundary violation')
  console.log('Runtime trace sensor detected synthetic IPv4/IPv6, regular-file HID-shaped open/ioctl, failed permission grant and helper exec')
} finally { await rm(directory,{recursive:true,force:true}) }
