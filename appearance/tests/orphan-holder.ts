/** Test-only parent-death fixture. Its child receives the read-only observer argv only. */
const child = Bun.spawn([process.argv[2]!], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
console.log(JSON.stringify({ pid: child.pid }))
const reader = child.stdout.getReader()
const first = await reader.read()
if (first.done) throw new Error('Observer exited before parent-death fixture was ready')
process.stdout.write(first.value)
// Keep the private stdin pipe alive until the test kills this process.
await Bun.sleep(60_000)
child.stdin.end()

export {}
