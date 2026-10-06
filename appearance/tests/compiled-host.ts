/* Compiled test entry; no renderer imports or native window. */
import { createSystemAppearanceSource } from '../../app/client/system-appearance'
const source = await createSystemAppearanceSource()
console.log(JSON.stringify(source.getSnapshot()))
source.dispose()
