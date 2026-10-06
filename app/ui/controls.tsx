import { forwardRef, useRef, useState, type ReactNode } from 'react';
import { useGpuix, type EventPayload, type PublicInstance, type StyleDesc } from '@gpuix/react';
import type { Palette } from '../theme/tokens';
export interface ButtonProps {
  children: ReactNode; label: string; onPress: () => void; palette: Palette; disabled?: boolean; primary?: boolean;
  style?: StyleDesc; tabIndex?: number; selected?: boolean; description?: string; testId?: string;
  onKeyDown?: (event: EventPayload) => void; onFocus?: () => void; autoFocus?: boolean;
}
/** 0.10.0 does not publish Button. Native click commits on release; Space commits
 * on key-up, Enter once on key-down. Blur/disable prevent a latched Space press. */
export const Button = forwardRef<PublicInstance, ButtonProps>(function Button({ children, label, onPress, palette: p, disabled = false, primary = false, style, tabIndex = 0, selected, description, testId, onKeyDown, onFocus, autoFocus }, forwardedRef) {
  const { renderer } = useGpuix();
  const instance = useRef<PublicInstance | null>(null);
  const spaceDown = useRef(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  if (disabled) spaceDown.current = false;
  return <div ref={value => { instance.current = value; if (typeof forwardedRef === 'function') forwardedRef(value); else if (forwardedRef) forwardedRef.current = value; }}
    role="button" aria-label={label} aria-description={disabled ? `${description ?? ''} Unavailable.`.trim() : description}
    aria-selected={selected} testId={testId} tabIndex={disabled ? -1 : tabIndex} autoFocus={autoFocus && !disabled}
    onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => { setFocused(false); spaceDown.current = false; setPressed(false); }}
    onMouseDown={() => { if (!disabled && instance.current) renderer?.focusElement?.(instance.current.id); }}
    onClick={() => { if (!disabled) onPress(); }}
    onKeyDown={event => {
      if (disabled) return;
      onKeyDown?.(event);
      if (event.isHeld || event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt) return;
      if (event.key === 'enter') onPress();
      if (event.key === 'space') { spaceDown.current = true; setPressed(true); }
    }}
    onKeyUp={event => { if (event.key === 'space') { const commit = spaceDown.current; spaceDown.current = false; setPressed(false); if (commit && !disabled) onPress(); } }}
    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 15, paddingRight: 15, minHeight: 40, borderRadius: 8, borderWidth: 2, borderColor: focused && !disabled ? p.accent : primary ? p.accent : p.border,
      backgroundColor: disabled ? p.subtle : primary ? p.accent : pressed ? p.selected : p.surface, cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none',
      hover: disabled ? {} : { backgroundColor: primary ? p.accent : p.selected }, active: disabled ? {} : { backgroundColor: primary ? p.accent : p.selected, borderColor: primary ? p.onAccent : p.text }, ...style, ...(focused && !disabled ? { borderColor: primary ? p.onAccent : p.text, borderWidth: 2 } : {}) }}>
    {typeof children === 'string' ? <text style={{ color: disabled ? p.secondary : primary ? p.onAccent : p.text, fontSize: 14, fontWeight: 600 }}>{children}</text> : children}
  </div>;
});
export function Label({ children, palette: p }: { children: ReactNode; palette: Palette }) {
  return <text style={{ color: p.secondary, fontSize: 12, fontWeight: 600 }}>{children}</text>;
}
export function Paragraph({ children, palette: p, small = false }: { children: ReactNode; palette: Palette; small?: boolean }) {
  return <text style={{ color: p.secondary, fontSize: small ? 13 : 15, lineHeight: small ? 19 : 22, whiteSpace: 'normal' }}>{children}</text>;
}
