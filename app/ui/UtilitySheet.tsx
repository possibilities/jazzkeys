import { useState } from 'react';
import type { EditorState, EditorIntent } from '../model/editor';
import type { Palette } from '../theme/tokens';
import { Button, Label, Paragraph } from './controls';
export function UtilitySheet({ state, palette: p, appearanceLabel, send, onClose }: { state: EditorState; palette: Palette; appearanceLabel: string; send: (intent: EditorIntent) => void; onClose: () => void }) {
  const [help, setHelp] = useState(false);
  const action = (intent: EditorIntent) => { send(intent); onClose(); };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 22, lineHeight: 28, fontWeight: 600 }}>JazzKeys</text>
      <Button palette={p} variant="quiet" label="Close JazzKeys utilities" testId="close-utilities" autoFocus onPress={onClose}>Done</Button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Label palette={p}>Appearance</Label><Paragraph palette={p}>{appearanceLabel}</Paragraph></div>
    <Button palette={p} variant="quiet" label={help ? 'Hide help and support limits' : 'Show help and support limits'} testId="show-help" onPress={() => setHelp(!help)} style={{ justifyContent: 'flex-start', paddingLeft: 0 }}>{help ? '⌄ Help and support limits' : '› Help and support limits'}</Button>
    {help ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Paragraph palette={p}>This build is an isolated demonstration. It does not open HID devices. Geometry, the controller, physical slots and the supported write path need device-specific verification before hardware changes can be enabled.</Paragraph>
      <Paragraph palette={p}>Future configuration uses a USB-C data cable and the keyboard’s wired USB mode. No receiver is needed. Bluetooth typing and unplug persistence require separate testing.</Paragraph>
      <Paragraph palette={p}>Fn, the dial and unknown actions stay protected. A keymap snapshot does not include firmware, lighting or macro bodies. Restoration must be reviewed as a new operation.</Paragraph>
      <Paragraph palette={p}>Tab moves between controls. Arrows select physical keys. Enter or Space activates. Escape closes the top popup or requests a simulation stop. Cmd/Ctrl Z affects only the local draft while a board key has focus.</Paragraph>
      <Paragraph palette={p} small>Native · offline · no analytics. No remote fonts, global typing listener or automatic device operations.</Paragraph>
    </div> : null}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTopWidth: 1, borderColor: p.border, paddingTop: 16 }}>
      <Label palette={p}>Demo actions</Label>
      {state.mode === 'demo' ? <Button palette={p} label="Disconnect demo and preserve draft" testId="disconnect-demo" onPress={() => action({ type: 'disconnect-demo' })}>Disconnect demo</Button> : null}
      {state.mode !== 'demo' ? <Button palette={p} label="Open a fresh demo and discard the existing simulated state" testId="reset-demo" onPress={() => action({ type: 'open-demo' })}>{state.mode === 'disconnected' ? 'Open demo' : 'Reset demo'}</Button> : null}
      <Button palette={p} label="Inspect a simulated read-only session. Your local draft is preserved." testId="preview-read-only" onPress={() => action({ type: 'show-read-only' })}>Preview read-only state</Button>
    </div>
  </div>;
}
