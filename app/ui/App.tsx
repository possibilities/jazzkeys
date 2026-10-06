import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useGpuix, useWindowSize, type PublicInstance } from '@gpuix/react';
import { DemoClient, type DemoScenario, type EditorClient } from '../client/demo';
import { editorReducer, type EditorIntent } from '../model/editor';
import { scenarioState, type NativeScenario } from '../model/scenarios';
import { FONT, palettes, type Appearance } from '../theme/tokens';
import { createAppearanceController, type AppearanceController } from '../theme/appearance';
import { Board, BoardCaption } from './Board';
import { Inspector } from './Inspector';
import { Review, Outcome } from './Review';
import { Button } from './controls';
import { DraftBar } from './DraftBar';
import { UtilitySheet } from './UtilitySheet';
import { benchLayout } from './bench-layout';
import { registerWindowKeys } from './keyboard';
export type { NativeScenario } from '../model/scenarios';
const fallbackAppearance = createAppearanceController();
export interface JazzkeysAppProps {
  initialScenario?: NativeScenario;
  /** Internal deterministic rendering fixture; there is no user theme override. */
  initialAppearance?: Appearance;
  viewportWidth?: number; viewportHeight?: number;
  /** Accepted for old evidence harnesses; Instrument Bench is the only composition. */
  designComposition?: 'board-and-inspector' | 'stacked-workbench';
  appearanceController?: AppearanceController;
  client?: EditorClient;
}
export function JazzkeysApp({ initialScenario = 'disconnected', initialAppearance, viewportWidth, viewportHeight, appearanceController = fallbackAppearance, client: providedClient }: JazzkeysAppProps = {}) {
  const [state, send] = useReducer(editorReducer, initialScenario, scenarioState);
  const appearanceState = useSyncExternalStore(appearanceController.subscribe, appearanceController.getSnapshot, appearanceController.getSnapshot);
  const appearance = initialAppearance ?? appearanceState.effectiveAppearance; const p = palettes[appearance];
  const { renderer } = useGpuix(); const size = useWindowSize();
  const width = viewportWidth ?? (size.width > 0 ? size.width : 1180);
  const height = viewportHeight ?? (size.height > 0 ? size.height : 780);
  const layout = benchLayout(width, height);
  const [utilities, setUtilities] = useState(false); const [scenario, setScenario] = useState<DemoScenario>('verified');
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const clientRef = useRef<EditorClient>(providedClient ?? new DemoClient());
  const applyStarted = useRef(false); const scopeRef = useRef<PublicInstance | null>(null); const returnFocus = useRef<number | null>(null);
  const modal = utilities || state.phase.kind !== 'editing';
  const modalPickerOpen = useRef(false); const pickerJustClosed = useRef(false);
  const updatePickerOpen = (open: boolean) => {
    if (modalPickerOpen.current && !open) { pickerJustClosed.current = true; setTimeout(() => { pickerJustClosed.current = false; }, 0); }
    modalPickerOpen.current = open;
  };
  const rememberFocus = () => { returnFocus.current = renderer?.getFocusedElementId?.() ?? null; };
  const openReview = () => { rememberFocus(); send({ type: 'review' }); };
  const closeModal = () => {
    if (utilities) setUtilities(false);
    else if (state.phase.kind === 'review') send({ type: 'close-review' });
    else if (state.phase.kind === 'outcome') send({ type: 'dismiss-outcome' });
    else if (state.phase.kind === 'applying') { clientRef.current.cancel(); setCancellationRequested(true); }
  };
  const wasModal = useRef(false);
  useLayoutEffect(() => {
    if (wasModal.current && !modal && returnFocus.current !== null) renderer?.focusElement?.(returnFocus.current);
    wasModal.current = modal;
  }, [modal, renderer]);
  const boardFocusIds = useRef(new Set<number>());
  useEffect(() => registerWindowKeys((event, native) => {
    if (modal) {
      if (event.key === 'tab' && scopeRef.current) { if (event.modifiers?.shift) native.focusPreviousWithin?.(scopeRef.current.id); else native.focusNextWithin?.(scopeRef.current.id); }
      if (event.key === 'escape' && !modalPickerOpen.current && !pickerJustClosed.current && !event.isHeld) closeModal();
      return;
    }
    // Native search-field undo stays with the input. This is not a typing hook.
    const focused = native.getFocusedElementId?.();
    if (focused !== undefined && focused !== null && (event.modifiers?.cmd || event.modifiers?.ctrl) && event.key === 'z' && boardFocusIds.current.has(focused)) send({ type: event.modifiers?.shift ? 'redo' : 'undo' });
  }), [modal, utilities, state.phase, renderer]);
  useEffect(() => () => clientRef.current.cancel(), []);
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
  const status = state.mode === 'disconnected' ? 'Hardware unavailable' : state.mode === 'offline' ? 'Offline draft · demo' : state.mode === 'read-only' ? 'Read-only · simulated' : 'Demo · no hardware access';
  return <div testId="jazzkeys-root" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden', position: 'relative', backgroundColor: p.canvas, fontFamily: FONT, color: p.text }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: layout.headerInset, paddingRight: layout.headerInset, height: 56, flexShrink: 0, borderBottomWidth: 1, borderColor: p.border }}>
      <text role="heading" aria-level={1} style={{ color: p.text, fontSize: 18, lineHeight: 24, fontWeight: 600 }}>Jazzkeys</text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ paddingLeft: 16, paddingRight: 16, height: 28, minWidth: 230, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: p.subtle, borderRadius: 7 }}><text role="status" aria-label={status} style={{ color: p.secondary, fontSize: 12, lineHeight: 18 }}>{status}</text></div>
        <Button palette={p} variant="quiet" label="Open Jazzkeys utilities and help" testId="more-utilities" disabled={modal} onPress={() => { rememberFocus(); setUtilities(true); }} style={{ paddingLeft: 4, paddingRight: 4 }}>More</Button>
      </div>
    </div>
    <div testId="bench-workspace" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, flexBasis: 0, minHeight: 0, overflowY: 'scroll', paddingTop: layout.topGap, paddingBottom: layout.bottomGap }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: layout.contentWidth, minHeight: layout.contextHeight, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <text style={{ color: p.text, fontSize: 22, lineHeight: 26, fontWeight: 600 }}>AK820 MAX</text>
          <text style={{ color: p.secondary, fontSize: 13, lineHeight: 18 }}>Illustrative demo</text>
        </div>
        <div role="group" aria-label="Keyboard layer" style={{ display: 'flex', alignItems: 'center', gap: 4, backgroundColor: p.subtle, borderRadius: 8, padding: 4, height: 36 }}>
          <Button palette={p} variant="segment" label="Show base layer" selected={state.layer === 'base'} testId="layer-base" disabled={modal || state.mode === 'disconnected'} onPress={() => send({ type: 'set-layer', layer: 'base' })} style={{ height: 28, minHeight: 28, paddingLeft: 16, paddingRight: 16 }}>Base</Button>
          <Button palette={p} variant="segment" label="Inspect unavailable Fn layer" selected={state.layer === 'fn'} testId="layer-fn" disabled={modal || state.mode === 'disconnected'} onPress={() => send({ type: 'set-layer', layer: 'fn' })} style={{ height: 28, minHeight: 28 }}><text style={{ color: p.secondary, fontSize: 12, lineHeight: 18 }}>Fn · unavailable</text></Button>
        </div>
      </div>
      {state.mode === 'read-only' || state.mode === 'offline' ? <div role="status" style={{ width: layout.contentWidth, marginTop: 12, padding: 12, backgroundColor: p.cautionSurface, borderRadius: 7, flexShrink: 0 }}><text style={{ color: p.caution, fontSize: 14, lineHeight: 20 }}>{state.mode === 'read-only' ? 'Simulated read-only session. This keyboard has not been verified for changes. Staging and apply are unavailable.' : 'Offline demo draft. Keep editing locally; a fresh read and a new review are required before another operation.'}</text></div> : null}
      <div style={{ height: layout.boardGap, flexShrink: 0 }} />
      <Board state={state} palette={p} unit={layout.unit} onSelect={id => send({ type: 'select-key', id })} onFocusId={id => boardFocusIds.current.add(id)} inactive={modal || state.mode === 'disconnected'} />
      <div style={{ height: layout.captionGap, flexShrink: 0 }} />
      <BoardCaption palette={p} width={layout.boardWidth} />
      <div style={{ height: layout.railGap, flexShrink: 0 }} />
      {state.mode === 'disconnected' ? <div testId="connection-rail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: 16, width: layout.contentWidth, minHeight: layout.railHeight, flexShrink: 0, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <text style={{ color: p.text, fontSize: 18, lineHeight: 24, fontWeight: 600 }}>Connect with a USB-C data cable</text>
          <text style={{ color: p.secondary, fontSize: 13, lineHeight: 18 }}>Use the keyboard’s wired USB mode. No receiver is needed.</text>
          <text style={{ color: p.caution, fontSize: 13, lineHeight: 18 }}>Hardware access is unavailable in this build</text>
        </div>
        <Button palette={p} label="Open isolated demo. No keyboard access." testId="open-demo" disabled={modal} onPress={() => send({ type: 'open-demo' })} style={{ width: 160 }}>Open demo</Button>
      </div> : <Inspector key={`${state.selected}:${state.layer}`} state={state} palette={p} appearance={appearance} width={layout.contentWidth} compact={layout.compact} disabled={modal} send={stageIntent} />}
    </div>
    {state.mode !== 'disconnected' ? <DraftBar state={state} palette={p} compact={layout.compact} disabled={modal} send={stageIntent} onReview={openReview} /> : <div style={{ height: 64, flexShrink: 0 }} />}
    {modal ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#07110B66', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, pointerEvents: 'auto' }}>
      <div ref={scopeRef} testId="review-sheet" role="dialog" aria-label={utilities ? 'Jazzkeys utilities and support limits' : state.phase.kind === 'outcome' ? 'Simulated apply outcome' : 'Review and simulate mapping changes'} style={{ display: 'flex', flexDirection: 'column', width: utilities ? 520 : 688, maxHeight: height - 64, overflowY: utilities ? 'scroll' : 'hidden', padding: 28, backgroundColor: p.surface, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
        {utilities ? <UtilitySheet state={state} palette={p} appearanceLabel={appearanceState.availabilityLabel} send={stageIntent} onClose={closeModal} /> : state.phase.kind === 'outcome' ? <Outcome state={state} palette={p} onClose={closeModal} /> : <Review state={state} palette={p} appearance={appearance} scenario={scenario} setScenario={setScenario} onCancel={closeModal} onApply={() => { void apply(); }} cancellationRequested={cancellationRequested} onPickerOpenChange={updatePickerOpen} />}
      </div>
    </div> : null}
  </div>;
}
export const App = JazzkeysApp;
