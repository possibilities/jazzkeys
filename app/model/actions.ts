/** Semantic keyboard actions only. No slot numbers, opcodes or raw device bytes. */
export interface KeyAction { readonly id: string; readonly label: string; readonly short: string; readonly group: 'Letters & numbers' | 'Navigation & function' | 'Modifiers' }
const action = (id: string, label: string, short = label, group: KeyAction['group'] = 'Navigation & function'): KeyAction => ({ id, label, short, group });
export const KEY_ACTIONS: readonly KeyAction[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => action(`key.${letter.toLowerCase()}`, letter, letter, 'Letters & numbers')),
  ...'1234567890'.split('').map(number => action(`key.${number}`, number, number, 'Letters & numbers')),
  action('key.escape', 'Escape', 'Esc'), action('key.caps-lock', 'Caps Lock', 'Caps'),
  action('key.enter', 'Enter'), action('key.tab', 'Tab'), action('key.space', 'Space'),
  action('key.backspace', 'Backspace', 'Bksp'), action('key.delete', 'Delete', 'Del'),
  action('key.home', 'Home'), action('key.end', 'End'), action('key.page-up', 'Page Up', 'PgUp'), action('key.page-down', 'Page Down', 'PgDn'),
  action('key.left', 'Left arrow', '←'), action('key.right', 'Right arrow', '→'), action('key.up', 'Up arrow', '↑'), action('key.down', 'Down arrow', '↓'),
  ...Array.from({length: 12}, (_, i) => action(`key.f${i + 1}`, `F${i + 1}`)),
  ...[['grave', '`'], ['minus', '−'], ['equal', '='], ['bracket-left', '['], ['bracket-right', ']'], ['backslash', '\\'], ['semicolon', ';'], ['quote', "'"], ['comma', ','], ['period', '.'], ['slash', '/']].map(([id, label]) => action(`key.${id}`, label!, label!, 'Letters & numbers')),
  action('modifier.left-control', 'Left Control', 'L Ctrl', 'Modifiers'),
  action('modifier.left-shift', 'Left Shift', 'L Shift', 'Modifiers'),
  action('modifier.left-alt', 'Left Alt / Option', 'L Alt', 'Modifiers'),
  action('modifier.left-gui', 'Left GUI / Command / Windows', 'L GUI', 'Modifiers'),
  action('modifier.right-control', 'Right Control', 'R Ctrl', 'Modifiers'),
  action('modifier.right-shift', 'Right Shift', 'R Shift', 'Modifiers'),
  action('modifier.right-alt', 'Right Alt / Option', 'R Alt', 'Modifiers'),
  action('modifier.right-gui', 'Right GUI / Command / Windows', 'R GUI', 'Modifiers'),
];
export const actionById = (id: string): KeyAction | undefined => KEY_ACTIONS.find(action => action.id === id);
export const actionLabel = (id: string): string => actionById(id)?.label ?? ({ 'protected.fn': 'Firmware Fn', 'protected.knob': 'Unverified knob function', 'protected.unknown': 'Unknown entry · preserved' }[id] ?? 'Unsupported entry · preserved');
export const actionShort = (id: string): string => actionById(id)?.short ?? 'Protected';
