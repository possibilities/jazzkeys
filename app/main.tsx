// Keep package verification entirely outside native rendering and window input.
export {};
import type { JazzkeysAppProps } from './ui/App';
if (process.argv.includes('--package-self-test')) {
  const { packageSelfTest } = await import('./bootstrap');
  await packageSelfTest();
} else if (process.argv.includes('--native-self-test')) {
  const native = await import('@gpuix/native');
  if (native.__napiBindingTarget !== 'native' || typeof native.GpuixRenderer !== 'function') throw new Error('Expected the pinned native renderer binding');
  console.log(JSON.stringify({nativeSelfTest:true,rendererBinding:'native',windowCreated:false,hardwareAccess:false}));
} else {
  const { requireNativeDisplay } = await import('./client/runtime-support');
  requireNativeDisplay(process.platform, process.env);
  const { createSystemAppearanceSource } = await import('./client/system-appearance');
  const { createAppearanceController } = await import('./theme/appearance');
  const appearanceSource = await createSystemAppearanceSource();
  const appearanceController = createAppearanceController({source:appearanceSource});
  process.once('exit', () => { appearanceController.dispose(); appearanceSource.dispose(); });
  const { render } = await import('@gpuix/react');
  const { JazzkeysApp } = await import('./ui/App');
  const { windowKeyHandler } = await import('./ui/keyboard');
  const { createElement } = await import('react');
  render(createElement<JazzkeysAppProps>(JazzkeysApp, {appearanceController}), { title: 'Jazzkeys', appName: 'Jazzkeys', appId: 'io.jazzkeys.desktop', width: 1180, height: 780, minWidth: 960, minHeight: 680, onKeyDown: windowKeyHandler });
}
