import { actionById } from './actions';
export interface PhysicalKey {
  readonly id: string; readonly legend: string; readonly x: number; readonly y: number; readonly width: number;
  readonly original: string; readonly protection?: string;
}
export const LAYOUT_ID = 'provisional-75-percent-demo-v1';
export const LAYOUT_WIDTH = 16;
export const LAYOUT_HEIGHT = 6.35;
// This is illustration geometry only. There is intentionally NO protocol slot map.
const keys: PhysicalKey[] = [];
function key(id: string, legend: string, x: number, y: number, width = 1, original = `key.${id}`, protection?: string): void {
  keys.push({ id, legend, x, y, width, original, ...(protection ? { protection } : {}) });
}
key('escape', 'Esc', 0, 0);
for (let n = 1; n <= 12; n++) key(`f${n}`, `F${n}`, 1.25 + n - 1 + Math.floor((n - 1) / 4) * .25, 0);
key('knob', 'Dial', 15, 0, 1, 'protected.knob', 'The knob and its press action have no verified mapping. They stay protected.');
const row = (ids: string[], legends: string[], y: number, start = 0) => ids.forEach((id, i) => key(id, legends[i]!, start + i, y));
row(['grave', ...'1234567890', 'minus', 'equal'], ['`', ...'1234567890', '−', '='], 1.35);
key('backspace', 'Backspace', 13, 1.35, 2); key('delete', 'Del', 15, 1.35);
key('tab', 'Tab', 0, 2.35, 1.5); row([... 'qwertyuiop', 'bracket-left', 'bracket-right'], [...'QWERTYUIOP', '[', ']'], 2.35, 1.5);
key('backslash', '\\', 13.5, 2.35, 1.5); key('home', 'Home', 15, 2.35, 1, 'protected.unknown', 'This demo entry is unknown. JazzKeys preserves unsupported entries instead of replacing them.');
key('caps-lock', 'Caps Lock', 0, 3.35, 1.75); row([... 'asdfghjkl', 'semicolon', 'quote'], [...'ASDFGHJKL', ';', "'"], 3.35, 1.75);
key('enter', 'Enter', 12.75, 3.35, 2.25); key('page-up', 'PgUp', 15, 3.35);
key('left-shift', 'Shift', 0, 4.35, 2.25, 'modifier.left-shift'); row([...'zxcvbnm', 'comma', 'period', 'slash'], [...'ZXCVBNM', ',', '.', '/'], 4.35, 2.25);
key('right-shift', 'Shift', 12.25, 4.35, 1.75, 'modifier.right-shift'); key('up', '↑', 14, 4.35); key('page-down', 'PgDn', 15, 4.35);
key('left-control', 'Ctrl', 0, 5.35, 1.25, 'modifier.left-control'); key('left-gui', 'GUI', 1.25, 5.35, 1.25, 'modifier.left-gui'); key('left-alt', 'Alt', 2.5, 5.35, 1.25, 'modifier.left-alt');
key('space', 'Space', 3.75, 5.35, 6.25); key('right-alt', 'Alt', 10, 5.35, 1, 'modifier.right-alt');
key('fn', 'Fn', 11, 5.35, 1, 'protected.fn', 'Fn is a firmware control. Its physical key is never editable.');
key('right-control', 'Ctrl', 12, 5.35, 1, 'modifier.right-control'); key('left', '←', 13, 5.35); key('down', '↓', 14, 5.35); key('right', '→', 15, 5.35);
export const DEMO_LAYOUT: readonly PhysicalKey[] = keys;
export const physicalKey = (id: string): PhysicalKey | undefined => DEMO_LAYOUT.find(key => key.id === id);
export function validateLayout(layout: readonly PhysicalKey[]): void {
  const ids = new Set<string>();
  for (const key of layout) {
    if (ids.has(key.id)) throw new Error(`Duplicate physical key: ${key.id}`);
    ids.add(key.id);
    if (![key.x, key.y, key.width].every(Number.isFinite) || key.x < 0 || key.y < 0 || key.width <= 0 || key.x + key.width > LAYOUT_WIDTH || key.y + 1 > LAYOUT_HEIGHT) throw new Error(`Invalid geometry: ${key.id}`);
    if (!key.protection && !actionById(key.original)) throw new Error(`Unsupported editable mapping: ${key.id}`);
  }
  for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
    const a = layout[i]!, b = layout[j]!;
    if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + 1 && a.y + 1 > b.y) throw new Error(`Overlapping keys: ${a.id}, ${b.id}`);
  }
}
validateLayout(DEMO_LAYOUT);
export type Direction = 'left' | 'right' | 'up' | 'down';
/** Spatial nearest neighbour; stable physical positions, never emitted usage. */
export function adjacentKey(id: string, direction: Direction): string {
  const from = physicalKey(id); if (!from) return DEMO_LAYOUT[0]!.id;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const cx = from.x + from.width / 2, cy = from.y + .5;
  const candidates = DEMO_LAYOUT.filter(key => key.id !== id).map(key => {
    const dx = key.x + key.width / 2 - cx, dy = key.y + .5 - cy;
    const forward = sign * (horizontal ? dx : dy), cross = Math.abs(horizontal ? dy : dx);
    return { key, forward, score: forward + cross * 4 };
  }).filter(candidate => candidate.forward > .01).sort((a, b) => a.score - b.score);
  return candidates[0]?.key.id ?? id;
}
