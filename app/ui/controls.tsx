import { forwardRef, useRef, useState, type ReactNode } from 'react';
import { useGpuix, type EventPayload, type PublicInstance, type StyleDesc } from '@gpuix/react';
import type { Palette } from '../theme/tokens';
export interface ButtonVisualState { focused: boolean; pressed: boolean; hovered: boolean }
export interface ButtonProps {
  children: ReactNode | ((state: ButtonVisualState) => ReactNode); label: string; onPress: () => void; palette: Palette; disabled?: boolean; primary?: boolean;
  variant?: 'secondary' | 'quiet' | 'segment' | 'key';
  style?: StyleDesc; tabIndex?: number; selected?: boolean; description?: string; testId?: string;
  onKeyDown?: (event: EventPayload) => void; onFocus?: () => void; autoFocus?: boolean;
}
/** 0.10.0 does not publish Button. Native click commits on release; Space commits
 * on key-up, Enter once on key-down. Blur/disable prevent a latched Space press.
 * Decorative key faces use the same activation owner as every other action. */
export const Button = forwardRef<PublicInstance, ButtonProps>(function Button({ children, label, onPress, palette: p, disabled = false, primary = false, variant = 'secondary', style, tabIndex = 0, selected, description, testId, onKeyDown, onFocus, autoFocus }, forwardedRef) {
  const { renderer } = useGpuix();
  const instance = useRef<PublicInstance | null>(null);
  const spaceDown = useRef(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  if (disabled) spaceDown.current = false;
  const quiet = variant === 'quiet' || variant === 'segment';
  const custom = variant === 'key';
  const background = primary ? p.accent : variant === 'segment' && selected ? p.surface : quiet ? 'transparent' : p.surface;
  const foreground = disabled ? p.secondary : primary ? p.onAccent : p.text;
  return <div ref={value => { instance.current = value; if (typeof forwardedRef === 'function') forwardedRef(value); else if (forwardedRef) forwardedRef.current = value; }}
    role="button" aria-label={label} aria-description={disabled ? `${description ?? ''} Unavailable.`.trim() : description}
    aria-selected={selected} testId={testId} tabIndex={disabled ? -1 : tabIndex} autoFocus={autoFocus && !disabled}
    onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => { setFocused(false); spaceDown.current = false; setPressed(false); }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
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
    style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', position: 'relative', paddingLeft: 14, paddingRight: 14, height: 40, minHeight: 40, borderRadius: 7, borderWidth: 1,
      borderColor: quiet ? 'transparent' : primary ? p.accent : p.controlStroke, backgroundColor: disabled && !quiet ? p.subtle : background,
      cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none',
      hover: disabled || custom ? {} : { backgroundColor: primary ? p.accent : p.subtle },
      active: disabled || custom ? {} : { backgroundColor: primary ? p.accent : p.subtle }, ...style }}>
    {!custom && focused && !disabled ? <div style={{ pointerEvents: 'none', position: 'absolute', top: -3, bottom: -3, left: -3, right: -3, borderRadius: 9, borderWidth: 2, borderColor: p.focus }} /> : null}
    {typeof children === 'function' ? children({ focused: focused && !disabled, pressed: pressed && !disabled, hovered: hovered && !disabled }) : typeof children === 'string' ? <text style={{ color: foreground, fontSize: 14, fontWeight: primary || selected ? 600 : 500, lineHeight: 20, whiteSpace: 'nowrap', textAlign: 'center' }}>{children}</text> : children}
  </div>;
});
export function Label({ children, palette: p }: { children: ReactNode; palette: Palette }) {
  return <text style={{ color: p.secondary, fontSize: 12, lineHeight: 16, fontWeight: 500 }}>{children}</text>;
}
export function Paragraph({ children, palette: p, small = false }: { children: ReactNode; palette: Palette; small?: boolean }) {
  return <text style={{ color: p.secondary, fontSize: small ? 12 : 14, lineHeight: small ? 18 : 20, whiteSpace: 'normal' }}>{children}</text>;
}
