import type { WindowKeyEventHandler } from '@gpuix/react';
let listener: WindowKeyEventHandler | undefined;
/** This is only the focused JazzKeys native window, never a global typing hook. */
export const windowKeyHandler: WindowKeyEventHandler = (event, renderer) => listener?.(event, renderer);
export function registerWindowKeys(handler: WindowKeyEventHandler): () => void {
  listener = handler;
  return () => { if (listener === handler) listener = undefined; };
}
