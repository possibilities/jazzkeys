import { checkPackagedWorker } from './client/worker'

/** Package smoke test exits before importing GPUIX or creating a window. */
export async function packageSelfTest(): Promise<void> {
  const result = await checkPackagedWorker()
  console.log(JSON.stringify({packageSelfTest:true,...result}))
}
