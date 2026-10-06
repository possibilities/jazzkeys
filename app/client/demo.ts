import type { DemoOutcome, DemoPlan, OutcomeKind } from '../model/editor';
export type DemoScenario = 'verified' | 'uncertain' | 'partial' | 'rejected' | 'snapshot-failed';
export interface DemoProgress { readonly planId: string; readonly step: 'snapshot' | 'sending' | 'settling' | 'verifying'; readonly sent: number }
export interface EditorClient {
  readonly mode: 'demo';
  apply(plan: DemoPlan, scenario: DemoScenario, onProgress: (event: DemoProgress) => void): Promise<DemoOutcome>;
  cancel(): void;
}
/** In-memory demonstration only. Cannot enumerate, open, spawn or write devices. */
export class DemoClient implements EditorClient {
  readonly mode = 'demo' as const;
  private consumed = new Set<string>();
  private active = false;
  private cancelled = false;
  constructor(private readonly pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 380))) {}
  cancel(): void { this.cancelled = true; }
  async apply(plan: DemoPlan, scenario: DemoScenario, onProgress: (event: DemoProgress) => void): Promise<DemoOutcome> {
    if (this.active || this.consumed.has(plan.id) || plan.mode !== 'demo' || !plan.changes.length) throw new Error('This demo plan is unavailable. Review a fresh draft.');
    this.active = true; this.cancelled = false; this.consumed.add(plan.id);
    const verifiedKeys: string[] = [], uncertainKeys: string[] = [], attemptedKeys: string[] = [];
    const outcome = (kind: OutcomeKind, message: string): DemoOutcome => ({ mode: 'demo', kind, planId: plan.id, changes: plan.changes, verifiedKeys: [...verifiedKeys], uncertainKeys: [...uncertainKeys], message });
    try {
      onProgress({ planId: plan.id, step: 'snapshot', sent: 0 }); await this.pause();
      if (this.cancelled) return outcome('cancelled', 'Simulation cancelled before any simulated mapping write.');
      if (scenario === 'snapshot-failed') return outcome('snapshot-failed', 'No keys were changed. The simulated original mapping could not be saved.');
      if (scenario === 'rejected') return outcome('rejected', 'No keys were changed. The simulated baseline changed after review.');
      for (let i = 0; i < plan.changes.length; i++) {
        if (this.cancelled) { uncertainKeys.push(...attemptedKeys); return outcome(attemptedKeys.length ? 'uncertain' : 'cancelled', 'Simulation stopped. Attempted simulated writes have not been read back.'); }
        attemptedKeys.push(plan.changes[i]!.physicalKey);
        onProgress({ planId: plan.id, step: 'sending', sent: i + 1 }); await this.pause();
        if (scenario === 'uncertain' || this.cancelled) {
          uncertainKeys.push(...attemptedKeys);
          return outcome('uncertain', 'The simulated keyboard stopped responding after a write. Some changes may have applied. Sending stopped.');
        }
        if (scenario === 'partial' && i === 0) {
          verifiedKeys.push(plan.changes[i]!.physicalKey);
          return outcome('partial', 'One simulated change read back correctly. Remaining changes were not sent.');
        }
      }
      onProgress({ planId: plan.id, step: 'settling', sent: plan.changes.length }); await this.pause();
      if (this.cancelled) {
        uncertainKeys.push(...plan.changes.map(change => change.physicalKey));
        return outcome('uncertain', 'Simulation stopped before read-back. Simulated writes have an unknown outcome.');
      }
      onProgress({ planId: plan.id, step: 'verifying', sent: plan.changes.length }); await this.pause();
      if (this.cancelled) {
        uncertainKeys.push(...plan.changes.map(change => change.physicalKey));
        return outcome('uncertain', 'Simulation cancelled during read-back. No verified result is claimed.');
      }
      verifiedKeys.push(...plan.changes.map(change => change.physicalKey));
      return outcome('verified', `${verifiedKeys.length} simulated ${verifiedKeys.length === 1 ? 'change' : 'changes'} read back correctly. No real keyboard was accessed.`);
    } finally { this.active = false; }
  }
}
