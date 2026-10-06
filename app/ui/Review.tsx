import { useState } from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@gpuix/react';
import type { DemoScenario } from '../client/demo';
import type { EditorState } from '../model/editor';
import { physicalKey } from '../model/layout';
import type { Appearance, Palette } from '../theme/tokens';
import { mappingLabel, physicalName } from './presentation';
import { Button, Label, Paragraph } from './controls';
const scenarios: { value: DemoScenario; label: string }[] = [
  { value: 'verified', label: 'Verified read-back' }, { value: 'uncertain', label: 'Response lost after write' },
  { value: 'partial', label: 'Partial result' }, { value: 'rejected', label: 'Stale baseline rejected' }, { value: 'snapshot-failed', label: 'Snapshot storage failure' },
];
export function Review({ state, palette: p, appearance, scenario, setScenario, onCancel, onApply, cancellationRequested, onPickerOpenChange }: { state: EditorState; palette: Palette; appearance: Appearance; scenario: DemoScenario; setScenario: (scenario: DemoScenario) => void; onCancel: () => void; onApply: () => void; cancellationRequested: boolean; onPickerOpenChange: (open: boolean) => void }) {
  const [demoOptions, setDemoOptions] = useState(false);
  if (state.phase.kind !== 'review' && state.phase.kind !== 'applying') return null;
  const plan = state.phase.plan, applying = state.phase.kind === 'applying';
  const step = state.phase.kind === 'applying' ? state.phase.step : null;
  const sent = state.phase.kind === 'applying' ? state.phase.sent : 0;
  const count = plan.changes.length;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0, flexShrink: 1 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <Label palette={p}>Demo · no hardware access</Label>
      <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 24, lineHeight: 30, fontWeight: 600 }}>{applying ? 'Simulating your changes' : `Review ${count} ${count === 1 ? 'change' : 'changes'}`}</text>
      <text style={{ color: p.secondary, fontSize: 13, lineHeight: 18 }}>AK820 MAX · demo profile · Base layer</text>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: p.border }}>
      <div style={{ display: 'flex', gap: 24, paddingTop: 10, paddingBottom: 10, flexShrink: 0 }}>
        {(['Physical key', 'Layer', 'Before', 'After'] as const).map((label, index) => <text key={label} style={{ color: p.secondary, fontSize: 12, lineHeight: 16, width: [124, 64, 174, 174][index] }}>{label}</text>)}
      </div>
      <div role="list" aria-label="Complete proposed mapping diff" style={{ display: 'flex', flexDirection: 'column', maxHeight: 224, minHeight: 56, flexShrink: 1, overflowY: 'scroll' }}>
        {plan.changes.map(change => <div key={change.physicalKey} role="listitem" aria-label={`${physicalName(physicalKey(change.physicalKey)!)}, Base layer, ${mappingLabel(change.before)} to ${mappingLabel(change.after)}`} style={{ display: 'flex', alignItems: 'center', gap: 24, minHeight: 56, flexShrink: 0, paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderColor: p.border }}>
          <text style={{ color: p.text, width: 124, fontSize: 14, lineHeight: 20, fontWeight: 600, whiteSpace: 'normal' }}>{physicalName(physicalKey(change.physicalKey)!)}</text>
          <text style={{ color: p.secondary, width: 64, fontSize: 13, lineHeight: 18 }}>Base</text>
          <text style={{ color: p.secondary, width: 174, fontSize: 14, lineHeight: 20, whiteSpace: 'normal' }}>{mappingLabel(change.before)}</text>
          <text style={{ color: p.text, width: 174, fontSize: 14, lineHeight: 20, fontWeight: 600, whiteSpace: 'normal' }}>{mappingLabel(change.after)}</text>
        </div>)}
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: 500 }}>Only these staged mappings are included</text>
      <Paragraph palette={p} small>{`${count} simulated single-key ${count === 1 ? 'write' : 'writes'}. Snapshot step is simulated in memory. No file or device traffic is created.`}</Paragraph>
      <Paragraph palette={p} small>A keymap snapshot excludes macro bodies, lighting and firmware.</Paragraph>
    </div>
    {applying ? <div role="status" aria-label="Simulated apply progress" style={{ padding: 16, backgroundColor: p.subtle, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        {(['snapshot', 'sending', 'settling', 'verifying'] as const).map((item, index) => <text key={item} style={{ color: p.secondary, fontSize: 12, lineHeight: 18, fontWeight: item === step ? 600 : 400 }}>{`${index + 1} ${item[0]!.toUpperCase()}${item.slice(1)}`}</text>)}
      </div>
      <text style={{ color: p.text, fontSize: 15, lineHeight: 20, fontWeight: 600 }}>{cancellationRequested ? 'Stopping at the next safe boundary' : step === 'snapshot' ? 'Checking simulated before-snapshot' : step === 'sending' ? `Sent ${sent} of ${count} · simulated` : step === 'settling' ? `Sent ${sent} of ${count} · waiting for simulated quiet time` : 'Checking simulated read-back'}</text>
      <Paragraph palette={p} small>Stopping cancels remaining work. It does not undo completed writes.</Paragraph>
    </div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <Button palette={p} variant="quiet" label={demoOptions ? 'Hide demo outcome options' : 'Choose demo outcome'} testId="demo-outcome-options" onPress={() => setDemoOptions(!demoOptions)} style={{ alignSelf: 'flex-start', height: 24, minHeight: 24, paddingLeft: 0, paddingRight: 4 }}>{demoOptions ? '⌄ Demo outcome' : '› Demo outcome'}</Button>
      {demoOptions ? <Select onOpenChange={onPickerOpenChange} value={scenario} items={scenarios} onValueChange={value => setScenario(value as DemoScenario)}>
        <SelectTrigger testId="demo-outcome-picker" role="button" aria-label={`Choose simulated apply outcome. ${appearance} appearance.`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 40, padding: 10, backgroundColor: p.surface, borderWidth: 1, borderColor: p.controlStroke, borderRadius: 7 }}>
          <text style={{ color: p.text, fontSize: 14, lineHeight: 20, whiteSpace: 'nowrap', flexGrow: 1 }}>{scenarios.find(item => item.value === scenario)?.label}</text>
          <text style={{ color: p.secondary, fontSize: 14, width: 16, textAlign: 'right' }}>⌄</text>
        </SelectTrigger>
        <SelectContent style={{ width: 360, padding: 6, backgroundColor: p.surface, borderWidth: 1, borderColor: p.controlStroke, borderRadius: 10 }} side="top">
          {scenarios.map(item => <SelectItem key={item.value} testId={`demo-outcome-${item.value}`} value={item.value} style={({ highlighted }) => ({ minHeight: 40, padding: 10, backgroundColor: highlighted ? p.subtle : p.surface })}><text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{item.label}</text></SelectItem>)}
        </SelectContent>
      </Select> : null}
    </div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0, paddingTop: 4 }}>
      <Button palette={p} label={applying ? 'Cancel remaining simulated writes' : 'Cancel review and keep draft'} testId="cancel-review" autoFocus onPress={onCancel} disabled={cancellationRequested}>{applying ? 'Stop remaining work' : 'Keep editing'}</Button>
      {!applying ? <Button palette={p} primary label={`Simulate applying ${count} changes. No device access.`} testId="simulate-apply" onPress={onApply}>{`Simulate ${count} ${count === 1 ? 'change' : 'changes'}`}</Button> : null}
    </div>
  </div>;
}
export function Outcome({ state, palette: p, onClose }: { state: EditorState; palette: Palette; onClose: () => void }) {
  if (state.phase.kind !== 'outcome') return null;
  const outcome = state.phase.outcome;
  const title = { verified: 'Simulated changes verified', partial: 'Some simulated changes verified', uncertain: 'The simulated result is uncertain', rejected: 'Simulated plan rejected before changes', 'snapshot-failed': 'Simulated snapshot step failed', cancelled: 'Simulation stopped' }[outcome.kind];
  const tone = outcome.kind === 'verified' ? p.accent : outcome.kind === 'rejected' || outcome.kind === 'snapshot-failed' ? p.error : p.caution;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0, flexShrink: 1 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <Label palette={p}>Demo outcome · no hardware accessed</Label>
      <text role="heading" aria-level={2} style={{ color: tone, fontSize: 24, lineHeight: 30, fontWeight: 600 }}>{title}</text>
      <Paragraph palette={p}>{outcome.kind === 'snapshot-failed' ? 'No simulated keys were changed. The original mapping could not be saved in the simulation.' : outcome.message}</Paragraph>
    </div>
    <div style={{ display: 'flex', gap: 24, padding: 16, backgroundColor: p.subtle, borderRadius: 8, flexShrink: 0 }}>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{`${outcome.verifiedKeys.length} verified`}</text>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{`${outcome.uncertainKeys.length} uncertain`}</text>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{`${outcome.changes.length - outcome.verifiedKeys.length - outcome.uncertainKeys.length} not applied`}</text>
    </div>
    <div role="list" aria-label="Per-key simulated outcomes" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 224, overflowY: 'scroll', minHeight: 40, flexShrink: 1 }}>
      {outcome.changes.map(change => {
        const verified = outcome.verifiedKeys.includes(change.physicalKey), uncertain = outcome.uncertainKeys.includes(change.physicalKey);
        return <div key={change.physicalKey} role="listitem" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexShrink: 0 }}>
          <text style={{ color: p.text, fontSize: 14, lineHeight: 20, whiteSpace: 'normal', flexGrow: 1, minWidth: 0 }}>{`${physicalName(physicalKey(change.physicalKey)!)} → ${mappingLabel(change.after)}`}</text>
          <text style={{ color: verified ? p.accent : uncertain ? p.caution : p.secondary, fontSize: 13, lineHeight: 20, width: 144 }}>{verified ? 'Read-back matched' : uncertain ? 'Uncertain' : 'Not applied'}</text>
        </div>;
      })}
    </div>
    <div style={{ flexShrink: 0 }}><Paragraph palette={p} small>{outcome.uncertainKeys.length ? 'Your draft is preserved offline. A fresh read and a new review are required before another operation. There is no automatic rollback or retry.' : 'This rehearses the interface only. USB persistence and Bluetooth behavior have not been tested.'}</Paragraph></div>
    <Button palette={p} label="Return to the preserved draft" testId="return-to-draft" onPress={onClose} autoFocus style={{ alignSelf: 'flex-end' }}>Return to draft</Button>
  </div>;
}
