// Keep package verification entirely outside native rendering and window input.
export {};
if (process.argv.includes('--package-self-test')) {
  const { packageSelfTest } = await import('./bootstrap');
  await packageSelfTest();
} else {
  const { render } = await import('@gpuix/react');
  const { JazzkeysApp } = await import('./ui/App');
  const { windowKeyHandler } = await import('./ui/keyboard');
  const { createElement } = await import('react');
  render(createElement(JazzkeysApp), { title: 'Jazzkeys', appName: 'Jazzkeys', appId: 'io.jazzkeys.desktop', width: 1180, height: 780, minWidth: 960, minHeight: 680, onKeyDown: windowKeyHandler });
}
