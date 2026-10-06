import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { useGpuix, useWindowSize, type PublicInstance } from '@gpuix/react';
import { DemoClient, type DemoScenario, type EditorClient } from '../client/demo';
import { changesFor, editorReducer, type EditorIntent } from '../model/editor';
import { scenarioState, type NativeScenario } from '../model/scenarios';
import { FONT, palettes, type Appearance } from '../theme/tokens';
import { Board } from './Board';
import { Inspector } from './Inspector';
import { Review, Outcome } from './Review';
import { Button, Label, Paragraph } from './controls';
import { registerWindowKeys } from './keyboard';
export type { NativeScenario } from '../model/scenarios';
export interface JazzkeysAppProps { initialScenario?: NativeScenario; initialAppearance?: Appearance; viewportWidth?: number; designComposition?: 'board-and-inspector' | 'stacked-workbench'; client?: EditorClient }
export function JazzkeysApp({ initialScenario = 'disconnected', initialAppearance = 'light', viewportWidth, designComposition = 'board-and-inspector', client: providedClient }: JazzkeysAppProps = {}) {
  const [state, send] = useReducer(editorReducer, initialScenario, scenarioState);
  const [appearance, setAppearance] = useState(initialAppearance); const p = palettes[appearance];
  const { renderer } = useGpuix(); const size = useWindowSize(); const width = viewportWidth ?? size.width ?? 1180;
  const narrow = (width > 0 && width < 1110) || designComposition === 'stacked-workbench';
  const [help, setHelp] = useState(false); const [scenario, setScenario] = useState<DemoScenario>('verified');
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const clientRef = useRef<EditorClient>(providedClient ?? new DemoClient());
  const applyStarted = useRef(false); const scopeRef = useRef<PublicInstance | null>(null); const returnFocus = useRef<number | null>(null);
  const pending = changesFor(state); const modal = help || state.phase.kind !== 'editing';
  const modalPickerOpen = useRef(false);
  const pickerJustClosed = useRef(false);
  const updatePickerOpen = (open: boolean) => {
    if (modalPickerOpen.current && !open) { pickerJustClosed.current = true; setTimeout(() => { pickerJustClosed.current = false; }, 0); }
    modalPickerOpen.current = open;
  };
  const rememberFocus = () => { returnFocus.current = renderer?.getFocusedElementId?.() ?? null; };
  const openReview = () => { rememberFocus(); send({ type: 'review' }); };
  const closeModal = () => {
    if (help) setHelp(false);
    else if (state.phase.kind === 'review') send({ type: 'close-review' });
    else if (state.phase.kind === 'outcome') send({ type: 'dismiss-outcome' });
    else if (state.phase.kind === 'applying') { clientRef.current.cancel(); setCancellationRequested(true); }
  };
  const wasModal = useRef(false);
  useLayoutEffect(() => {
    if (wasModal.current && !modal && returnFocus.current !== null) renderer?.focusElement?.(returnFocus.current);
    wasModal.current = modal;
  }, [modal, renderer]);
  useEffect(() => registerWindowKeys((event, native) => {
    if (modal) {
      if (event.key === 'tab' && scopeRef.current) { if (event.modifiers?.shift) native.focusPreviousWithin?.(scopeRef.current.id); else native.focusNextWithin?.(scopeRef.current.id); }
      if (event.key === 'escape' && !modalPickerOpen.current && !pickerJustClosed.current && !event.isHeld) closeModal();
      return;
    }
    // Search inputs keep their own native text undo. Shortcuts only act while a
    // physical key owns focus; ordinary typing is never treated as a mapping.
    const focused = native.getFocusedElementId?.();
    if (focused === undefined || focused === null) return;
    if ((event.modifiers?.cmd || event.modifiers?.ctrl) && event.key === 'z') {
      const keyFocus = boardFocusIds.current.has(focused);
      if (keyFocus) send({ type: event.modifiers?.shift ? 'redo' : 'undo' });
    }
  }), [modal, help, state.phase, renderer]);
  useEffect(() => () => clientRef.current.cancel(), []);
  // Board key focus is identified through the renderer's scoped event IDs,
  // avoiding global shortcuts inside the native searchable combobox.
  const boardFocusIds = useRef(new Set<number>());
  const stageIntent = (intent: EditorIntent) => send(intent);
  async function apply(): Promise<void> {
    if (state.phase.kind !== 'review' || applyStarted.current) return;
    applyStarted.current = true; setCancellationRequested(false);
    const plan = state.phase.plan; send({ type: 'start-apply', planId: plan.id });
    try {
      const outcome = await clientRef.current.apply(plan, scenario, progress => send({ type: 'progress', ...progress }));
      send({ type: 'outcome', outcome });
    } catch {
      send({ type: 'outcome', outcome: { mode: 'demo', planId: plan.id, kind: 'rejected', changes: plan.changes, verifiedKeys: [], uncertainKeys: [], message: 'The simulation could not start. No real keyboard was accessed.' } });
    } finally { applyStarted.current = false; setCancellationRequested(false); }
  }
  const status = state.mode === 'disconnected' ? 'Disconnected' : state.mode === 'offline' ? 'Offline draft · demo' : state.mode === 'read-only' ? 'Read-only · simulated' : 'Demo · no HID access';
  return <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden', position: 'relative', backgroundColor: p.canvas, fontFamily: FONT, color: p.text }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 32, paddingRight: 32, height: 78, flexShrink: 0, borderBottomWidth: 1, borderColor: p.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <text role="heading" aria-level={1} style={{ color: p.text, fontSize: 25, fontWeight: 700 }}>Jazzkeys</text>
        <text style={{ color: p.secondary, fontSize: 13 }}>A careful key mapper</text>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <text role="status" aria-label={status} style={{ color: state.mode === 'demo' ? p.accent : p.secondary, fontSize: 13, fontWeight: 600 }}>{status}</text>
        <Button palette={p} label={appearance === 'light' ? 'Use dark appearance' : 'Use light appearance'} disabled={modal} onPress={() => setAppearance(appearance === 'light' ? 'dark' : 'light')}>{appearance === 'light' ? 'Dark' : 'Light'}</Button>
        <Button palette={p} label="Open Jazzkeys help and support limits" disabled={modal} onPress={() => { rememberFocus(); setHelp(true); }}>Help</Button>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minHeight: 0, overflowY: 'scroll', padding: 32, gap: 27 }}>
      {state.mode === 'disconnected' ? <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 700 }}>
          <Label palette={p}>AJAZZ × NACODEX AK820 MAX</Label>
          <text style={{ color: p.text, fontSize: 34, fontWeight: 600 }}>Make a few keys feel like yours</text>
          <Paragraph palette={p}>Connect your AK820 MAX with a USB-C data cable. Bluetooth is for typing, not configuration. No receiver is needed.</Paragraph>
        </div>
        <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 30, alignItems: narrow ? 'stretch' : 'flex-start' }}>
          <Board state={state} palette={p} inactive onSelect={() => {}} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 245, flexGrow: 1 }}>
            <text style={{ color: p.text, fontSize: 20, fontWeight: 600 }}>Start with a rehearsal</text>
            <Paragraph palette={p}>Explore the editor with a sample keymap. Stage a change, review the diff and try each outcome.</Paragraph>
            <Button palette={p} primary label="Open isolated demo. No keyboard access." testId="open-demo" disabled={modal} onPress={() => send({ type: 'open-demo' })}>Open demo</Button>
            <Paragraph palette={p} small>Hardware access is unavailable in this build. This keyboard’s identity and physical slot map still need verification.</Paragraph>
            <Button palette={p} label="Inspect a simulated read-only session" disabled={modal} onPress={() => send({ type: 'show-read-only' })}>Preview read-only state</Button>
          </div>
        </div>
      </> : <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Label palette={p}>AK820 MAX · ILLUSTRATIVE DEMO</Label>
            <text style={{ color: p.text, fontSize: 23, fontWeight: 600 }}>A small change, made deliberately</text>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button palette={p} label="Show base layer" selected={state.layer === 'base'} disabled={modal} onPress={() => send({ type: 'set-layer', layer: 'base' })} style={{ backgroundColor: state.layer === 'base' ? p.selected : p.surface }}>Base</Button>
            <Button palette={p} label="Inspect unavailable Fn layer" selected={state.layer === 'fn'} disabled={modal} onPress={() => send({ type: 'set-layer', layer: 'fn' })} style={{ backgroundColor: state.layer === 'fn' ? p.selected : p.surface }}>Fn · protected</Button>
          </div>
        </div>
        {state.mode === 'read-only' || state.mode === 'offline' ? <div role="status" style={{ backgroundColor: p.cautionSurface, borderRadius: 8, padding: 14 }}><text style={{ color: p.caution, fontSize: 14 }}>{state.mode === 'read-only' ? 'Simulated read-only session. This keyboard has not been verified for changes. Apply is unavailable.' : 'Offline demo draft. A fresh read and new review are required before another operation.'}</text></div> : null}
        <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 28, alignItems: narrow ? 'stretch' : 'flex-start' }}>
          <Board state={state} palette={p} onSelect={id => send({ type: 'select-key', id })} onFocusId={id => boardFocusIds.current.add(id)} inactive={modal} />
          <Inspector key={state.selected} state={help ? { ...state, phase: { kind: 'review', plan: { id: 'help', mode: 'demo', generation: 0, revision: 0, changes: [] } } } : state} palette={p} send={stageIntent} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <text role="status" style={{ color: p.secondary, fontSize: 13 }}>{state.notice ?? 'Tab enters the board · arrows select keys · Cmd/Ctrl Z undoes a draft edit while the board is focused'}</text>
          <Button palette={p} label={state.mode === 'demo' ? 'Disconnect demo and preserve draft' : 'Start a fresh demo and discard this simulated state'} disabled={modal} onPress={() => send({ type: state.mode === 'demo' ? 'disconnect-demo' : 'open-demo' })} style={{ minHeight: 32 }}>{state.mode === 'demo' ? 'Disconnect demo' : 'Reset demo'}</Button>
        </div>
      </>}
    </div>
    {state.mode !== 'disconnected' ? <>
        <div testId="draft-action-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0, paddingTop: 17, paddingBottom: 17, paddingLeft: 32, paddingRight: 32, backgroundColor: p.canvas, borderTopWidth: 1, borderColor: p.border }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><text style={{ color: p.text, fontSize: 19, fontWeight: 600 }}>{`${pending.length} pending ${pending.length === 1 ? 'change' : 'changes'}`}</text><Paragraph palette={p} small>Local draft only · current profile is simulated</Paragraph></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button palette={p} label="Undo draft edit" disabled={modal || !state.past.length || state.layer === 'fn'} onPress={() => send({ type: 'undo' })}>Undo</Button>
            <Button palette={p} label="Redo draft edit" disabled={modal || !state.future.length || state.layer === 'fn'} onPress={() => send({ type: 'redo' })}>Redo</Button>
            <Button palette={p} label="Discard all pending draft changes" disabled={modal || !pending.length || state.layer === 'fn'} onPress={() => send({ type: 'discard' })}>Discard</Button>
            <Button palette={p} primary label={`Review ${pending.length} pending changes`} testId="review-changes" disabled={modal || !pending.length || state.mode !== 'demo'} onPress={openReview}>{`Review ${pending.length} ${pending.length === 1 ? 'change' : 'changes'}`}</Button>
          </div>
        </div>
    </> : null}
    <div style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0, paddingLeft: 32, paddingRight: 32, paddingTop: 13, paddingBottom: 13, borderTopWidth: 1, borderColor: p.border }}>
      <text style={{ color: p.secondary, fontSize: 12 }}>Native · offline · no analytics</text>
      <text style={{ color: p.secondary, fontSize: 12 }}>Provisional geometry · hardware writes unavailable</text>
    </div>
    {modal ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#07110BB8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, pointerEvents: 'auto' }}>
      <div ref={scopeRef} testId="review-sheet" role="dialog" aria-label={help ? 'Jazzkeys help and honest support limits' : state.phase.kind === 'outcome' ? 'Simulated apply outcome' : 'Review and simulate mapping changes'} style={{ display: 'flex', flexDirection: 'column', width: 620, maxHeight: '92%', overflowY: 'scroll', padding: 28, backgroundColor: p.surface, borderRadius: 16, borderWidth: 1, borderColor: p.border }}>
        {help ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 25, fontWeight: 600 }}>A careful place to begin</text>
          <Paragraph palette={p}>Jazzkeys is a native editor for the AJAZZ × NACODEX AK820 MAX. This build offers an isolated demonstration. It does not open HID devices.</Paragraph>
          <Paragraph palette={p}>The demo geometry is provisional. The real controller, current profile, physical slots and supported single-key write path need device-specific evidence before hardware changes can be enabled.</Paragraph>
          <Paragraph palette={p}>Use a direct USB-C data cable and the keyboard’s wired USB mode for future configuration. Bluetooth typing remains a separate persistence check. A 2.4 GHz receiver is not required.</Paragraph>
          <Paragraph palette={p}>Fn, knob, firmware-special and unknown entries are protected. Snapshots cover keymaps, not firmware, lighting or macro bodies. Restoration must be reviewed as a new operation.</Paragraph>
          <Paragraph palette={p} small>Keyboard: Tab between controls; arrow keys move around the board; Enter or Space activates; Escape closes the top sheet or asks an active simulation to stop. Undo affects only the local draft.</Paragraph>
          <Button palette={p} label="Close help" autoFocus onPress={closeModal}>Back to Jazzkeys</Button>
        </div> : state.phase.kind === 'outcome' ? <Outcome state={state} palette={p} onClose={closeModal} /> : <Review state={state} palette={p} scenario={scenario} setScenario={setScenario} onCancel={closeModal} onApply={() => { void apply(); }} cancellationRequested={cancellationRequested} onPickerOpenChange={updatePickerOpen} />}
      </div>
    </div> : null}
  </div>;
}
export const App = JazzkeysApp;
