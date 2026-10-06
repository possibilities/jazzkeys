import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@gpuix/react';
import type { DemoScenario } from '../client/demo';
import type { EditorState } from '../model/editor';
import { actionLabel } from '../model/actions';
import { DEMO_LAYOUT, physicalKey } from '../model/layout';
import type { Palette } from '../theme/tokens';
import { Button, Label, Paragraph } from './controls';
const scenarios: { value: DemoScenario; label: string }[] = [
  { value: 'verified', label: 'Verified read-back' }, { value: 'uncertain', label: 'Response lost after write' },
  { value: 'partial', label: 'Partial result' }, { value: 'rejected', label: 'Stale baseline rejected' }, { value: 'snapshot-failed', label: 'Snapshot storage failure' },
];
export function Review({ state, palette: p, scenario, setScenario, onCancel, onApply, cancellationRequested, onPickerOpenChange }: { state: EditorState; palette: Palette; scenario: DemoScenario; setScenario: (scenario: DemoScenario) => void; onCancel: () => void; onApply: () => void; cancellationRequested: boolean; onPickerOpenChange: (open: boolean) => void }) {
  if (state.phase.kind !== 'review' && state.phase.kind !== 'applying') return null;
  const plan = state.phase.plan, applying = state.phase.kind === 'applying';
  const step = state.phase.kind === 'applying' ? state.phase.step : null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <Label palette={p}>DEMO · NO HARDWARE ACCESS</Label>
      <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 25, fontWeight: 600 }}>{applying ? 'Simulating your changes' : `Review ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'}`}</text>
      <Paragraph palette={p}>Illustrative AK820 MAX · simulated current profile · base layer</Paragraph>
    </div>
    <div role="list" aria-label="Complete proposed mapping diff" style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderBottomWidth: 1, borderColor: p.border }}>
      {plan.changes.map(change => <div key={change.physicalKey} role="listitem" aria-label={`${physicalKey(change.physicalKey)?.legend}, ${actionLabel(change.before)} to ${actionLabel(change.after)}`} style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 15, paddingBottom: 15 }}>
        <text style={{ color: p.text, width: 98, fontSize: 14, fontWeight: 600 }}>{physicalKey(change.physicalKey)?.legend}</text>
        <text style={{ color: p.secondary, flexGrow: 1, fontSize: 14 }}>{actionLabel(change.before)}</text>
        <text style={{ color: p.secondary, fontSize: 16 }}>→</text>
        <text style={{ color: p.accent, width: 182, fontSize: 14, fontWeight: 600 }}>{actionLabel(change.after)}</text>
      </div>)}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <text style={{ color: p.text, fontSize: 14, fontWeight: 600 }}>{`${plan.changes.length} simulated single-key ${plan.changes.length === 1 ? 'write' : 'writes'} · ${DEMO_LAYOUT.length - plan.changes.length} pictured keys unchanged`}</text>
      <Paragraph palette={p} small>Protected Fn, knob and unknown entries stay unchanged. A keymap snapshot excludes macro bodies, lighting and firmware.</Paragraph>
      <Paragraph palette={p} small>{applying ? 'Snapshot, progress and verification below are simulated in memory.' : 'The simulation checks its snapshot step before any simulated write. No snapshot file or device traffic is created.'}</Paragraph>
    </div>
    {applying ? <div role="status" aria-label="Simulated apply progress" style={{ padding: 17, backgroundColor: p.subtle, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <text style={{ color: p.text, fontSize: 16, fontWeight: 600 }}>{cancellationRequested ? 'Stopping at the next safe boundary…' : step === 'snapshot' ? 'Checking simulated before-snapshot…' : step === 'sending' ? `Simulated writes: ${state.phase.kind === 'applying' ? state.phase.sent : 0} of ${plan.changes.length}` : step === 'settling' ? 'Waiting for a simulated quiet period…' : 'Checking simulated read-back…'}</text>
      <Paragraph palette={p} small>Cancellation stops remaining work. It does not undo completed writes.</Paragraph>
    </div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <Label palette={p}>DEMONSTRATION OUTCOME</Label>
      <Select onOpenChange={onPickerOpenChange} value={scenario} items={scenarios} onValueChange={value => setScenario(value as DemoScenario)}>
        <SelectTrigger role="button" aria-label="Choose simulated apply outcome" style={{ height: 40, padding: 10, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: 7 }}>
          <SelectValue>{<text style={{ color: p.text, fontSize: 14 }}>{scenarios.find(item => item.value === scenario)?.label} ▾</text>}</SelectValue>
        </SelectTrigger>
        <SelectContent style={{ width: 360, padding: 6, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: 8 }}>
          {scenarios.map(item => <SelectItem key={item.value} value={item.value} style={({ highlighted }) => ({ padding: 10, backgroundColor: highlighted ? p.selected : p.surface })}><text style={{ color: p.text, fontSize: 14 }}>{item.label}</text></SelectItem>)}
        </SelectContent>
      </Select>
    </div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
      <Button palette={p} label={applying ? 'Cancel remaining simulated writes' : 'Cancel review and keep draft'} testId="cancel-review" autoFocus onPress={onCancel} disabled={cancellationRequested}>{applying ? 'Stop remaining work' : 'Keep editing'}</Button>
      {!applying ? <Button palette={p} primary label={`Simulate applying ${plan.changes.length} changes. No device access.`} testId="simulate-apply" onPress={onApply}>{`Simulate ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'}`}</Button> : null}
    </div>
  </div>;
}
export function Outcome({ state, palette: p, onClose }: { state: EditorState; palette: Palette; onClose: () => void }) {
  if (state.phase.kind !== 'outcome') return null;
  const outcome = state.phase.outcome;
  const title = { verified: 'Simulated changes verified', partial: 'Some simulated changes verified', uncertain: 'The simulated result is uncertain', rejected: 'Plan rejected before changes', 'snapshot-failed': 'Snapshot step blocked changes', cancelled: 'Simulation stopped' }[outcome.kind];
  const tone = outcome.kind === 'verified' ? p.accent : outcome.kind === 'rejected' || outcome.kind === 'snapshot-failed' ? p.error : p.caution;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <Label palette={p}>DEMO OUTCOME · NO HARDWARE ACCESSED</Label>
    <text role="heading" aria-level={2} style={{ color: tone, fontSize: 25, fontWeight: 600 }}>{title}</text>
    <Paragraph palette={p}>{outcome.message}</Paragraph>
    <div style={{ display: 'flex', gap: 24, padding: 16, backgroundColor: p.subtle, borderRadius: 8 }}>
      <text style={{ color: p.text, fontSize: 15 }}>{`${outcome.verifiedKeys.length} verified`}</text>
      <text style={{ color: p.text, fontSize: 15 }}>{`${outcome.uncertainKeys.length} uncertain`}</text>
      <text style={{ color: p.text, fontSize: 15 }}>{`${outcome.changes.length - outcome.verifiedKeys.length - outcome.uncertainKeys.length} not applied`}</text>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {outcome.changes.map(change => <div key={change.physicalKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <text style={{ color: p.text, fontSize: 14 }}>{`${physicalKey(change.physicalKey)?.legend} → ${actionLabel(change.after)}`}</text>
        <text style={{ color: p.secondary, fontSize: 13 }}>{outcome.verifiedKeys.includes(change.physicalKey) ? 'Read-back matched' : outcome.uncertainKeys.includes(change.physicalKey) ? 'Unknown outcome' : 'Not applied'}</text>
      </div>)}
    </div>
    <Paragraph palette={p} small>{outcome.uncertainKeys.length ? 'Your draft is preserved offline. A fresh read and a new review are required before another operation. There is no automatic rollback or retry.' : 'This rehearses the interface only. USB persistence and Bluetooth behavior have not been tested.'}</Paragraph>
    <Button palette={p} label="Return to the preserved draft" onPress={onClose} autoFocus>Return to draft</Button>
  </div>;
}
