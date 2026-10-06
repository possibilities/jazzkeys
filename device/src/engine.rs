//! One mutable owner spans preflight, storage, wire writes, read-back and settling.
use crate::{
    domain::*,
    protocol::{Clock, Operation, Scheduler, Transport},
    storage::{JournalChange, JournalEvent, JournalIntent, Store},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Default)]
pub(crate) struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    fn requested(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Clone)]
struct Session {
    id: String,
    generation: u64,
    identity: Identity,
    profile: Profile,
    baseline: BTreeMap<Layer, Keymap>,
}
#[derive(Clone)]
struct Change {
    key: String,
    slot: Slot,
    before: Entry,
    after: Entry,
}
#[derive(Clone)]
struct Plan {
    id: String,
    session_id: String,
    generation: u64,
    expires_ms: u64,
    layer: Layer,
    before: Keymap,
    desired: Keymap,
    changes: Vec<Change>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MappingMismatch {
    pub physical_key: String,
    pub expected: Option<Target>,
    pub actual: Option<Target>,
    pub actual_unsupported: bool,
    pub changed_from_original: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    pub status: &'static str,
    pub session_id: String,
    pub plan_id: String,
    pub snapshot_id: Option<String>,
    pub attempted: usize,
    pub verified: usize,
    pub unknown: usize,
    pub not_attempted: usize,
    pub preserved: bool,
    pub readback_complete: bool,
    pub cancelled: bool,
    pub verified_keys: Vec<String>,
    pub unknown_keys: Vec<String>,
    pub reason: Option<&'static str>,
    pub mismatches: Vec<MappingMismatch>,
    #[serde(skip_serializing)]
    observed: Option<Keymap>,
}
pub(crate) struct Engine<T, C, S> {
    pub scheduler: Scheduler<T, C>,
    pub store: S,
    capability: Capability,
    session: Option<Session>,
    plan: Option<Plan>,
    nonce: String,
    generation: u64,
    sequence: u64,
}
impl<T: Transport, C: Clock, S: Store> Engine<T, C, S> {
    pub(crate) fn new(
        transport: T,
        clock: C,
        store: S,
        capability: Capability,
        owner_nonce: String,
    ) -> Result<Self> {
        capability.validate()?;
        if !valid_id(&owner_nonce) || owner_nonce.len() > 24 {
            return Err(INVALID);
        }
        let scheduler = Scheduler::new(transport, clock, capability.identity.interface.clone());
        Ok(Self {
            scheduler,
            store,
            capability,
            session: None,
            plan: None,
            nonce: owner_nonce,
            generation: 0,
            sequence: 0,
        })
    }
    fn next_id(&mut self, label: &str) -> String {
        self.sequence += 1;
        format!(
            "{}-{}-{}-{}",
            self.nonce, self.generation, label, self.sequence
        )
    }
    pub(crate) fn connect(&mut self) -> Result<String> {
        if self.generation != 0 {
            return Err(Fault::new(
                "fresh_owner_required",
                "Reconnect requires a fresh transport owner and nonce",
            ));
        }
        self.plan = None;
        self.session = None;
        self.generation += 1;
        let (identity, profile) = self.probe()?;
        if !self.capability.profiles.contains(&profile.wire()) {
            return Err(READ_ONLY);
        }
        let id = self.next_id("session");
        self.session = Some(Session {
            id: id.clone(),
            generation: self.generation,
            identity,
            profile,
            baseline: BTreeMap::new(),
        });
        Ok(id)
    }
    fn invalidate(&mut self) {
        self.plan = None;
        self.session = None;
        self.scheduler.invalidate();
    }
    fn session(&self, id: &str) -> Result<Session> {
        self.session
            .as_ref()
            .filter(|session| session.id == id && session.generation == self.generation)
            .cloned()
            .ok_or(STALE)
    }
    fn probe(&mut self) -> Result<(Identity, Profile)> {
        let identify = self.scheduler.read(Operation::Identify)?;
        if identify[0] != 0x8f {
            return self.identity_error();
        }
        let id = u32::from_le_bytes(identify[1..5].try_into().map_err(|_| INVALID)?);
        if id != self.capability.identity.internal_id {
            return self.identity_error();
        }
        let revision = self.scheduler.read(Operation::Revision)?;
        if revision[0] != 0x80 {
            return self.identity_error();
        }
        let revision = u32::from_le_bytes(revision[1..5].try_into().map_err(|_| INVALID)?);
        if revision != self.capability.identity.revision {
            return self.identity_error();
        }
        let profile = self.scheduler.read(Operation::CurrentProfile)?;
        if profile[0] != 0x85 {
            return self.identity_error();
        }
        let profile = match Profile::observed(profile[1]) {
            Ok(profile) => profile,
            Err(error) => {
                self.invalidate();
                return Err(error);
            }
        };
        Ok((self.capability.identity.clone(), profile))
    }
    fn identity_error<U>(&mut self) -> Result<U> {
        self.invalidate();
        Err(STALE)
    }
    fn revalidate(&mut self, session: &Session) -> Result<()> {
        let (identity, profile) = self.probe()?;
        if identity != session.identity
            || profile != session.profile
            || self.generation != session.generation
        {
            return self.identity_error();
        }
        Ok(())
    }
    fn sweep(&mut self, session: &Session, layer: Layer) -> Result<Keymap> {
        if !self.capability.read_layers.contains(&layer) {
            return Err(READ_ONLY);
        }
        let mut bytes = [0_u8; LAYER_BYTES];
        for page in 0..8_u8 {
            let response = self.scheduler.read(Operation::ReadPage {
                layer,
                profile: session.profile,
                page,
            })?;
            bytes[usize::from(page) * 64..usize::from(page + 1) * 64].copy_from_slice(&response);
        }
        Keymap::from_bytes(&bytes)
    }
    fn stable(&mut self, session: &Session, layer: Layer) -> Result<Keymap> {
        self.revalidate(session)?;
        let first = self.sweep(session, layer)?;
        let second = self.sweep(session, layer)?;
        if first != second {
            self.invalidate();
            return Err(Fault::new(
                "unstable_read",
                "Two complete keymap sweeps did not agree",
            ));
        }
        self.revalidate(session)?;
        Ok(first)
    }
    fn read_current(&mut self, id: &str, layer: Layer) -> Result<Value> {
        let session = self.session(id)?;
        let map = self.stable(&session, layer)?;
        if let Some(current) = self.session.as_mut() {
            current.baseline.insert(layer, map.clone());
        }
        let keys:Vec<Value>=self.capability.keys.iter().map(|key|json!({"physicalKey":key.id,"target":Target::from_entry(map.0[key.slot.index()]),"editable":!key.protected&&Target::from_entry(map.0[key.slot.index()]).is_some()&&self.capability.write_layers.contains(&layer)})).collect();
        Ok(
            json!({"type":"keymap","sessionId":id,"layer":layer,"baselineHash":map.hash(),"currentProfile":session.profile.wire(),"keys":keys}),
        )
    }
    fn prepare(
        &mut self,
        id: &str,
        layer: Layer,
        baseline_hash: &str,
        edits: Vec<Edit>,
    ) -> Result<Value> {
        let session = self.session(id)?;
        if !self.capability.write_layers.contains(&layer) {
            return Err(READ_ONLY);
        }
        if edits.len() > SLOTS {
            return Err(INVALID);
        }
        let baseline = session.baseline.get(&layer).ok_or(STALE)?;
        if baseline.hash() != baseline_hash {
            return Err(Fault::new(
                "baseline_conflict",
                "Draft is based on a different keymap",
            ));
        }
        // Validate the entire semantic list before taking a fresh read, let alone sending writes.
        let mut ids = BTreeSet::new();
        let mut slots = BTreeSet::new();
        for edit in &edits {
            let key = self.capability.key(&edit.physical_key)?;
            if key.protected || Target::from_entry(baseline.0[key.slot.index()]).is_none() {
                return Err(Fault::new(
                    "protected_key",
                    "This entry must remain byte-identical",
                ));
            }
            if !ids.insert(&edit.physical_key) || !slots.insert(key.slot.index()) {
                return Err(Fault::new(
                    "duplicate_key",
                    "The complete draft contains duplicate keys or slots",
                ));
            }
        }
        let fresh = self.stable(&session, layer)?;
        if fresh != *baseline {
            return Err(Fault::new(
                "baseline_conflict",
                "Current keymap changed; read and rebase the draft",
            ));
        }
        let mut desired = fresh.clone();
        let mut changes = Vec::new();
        for edit in edits {
            let key = self.capability.key(&edit.physical_key)?;
            let before = fresh.0[key.slot.index()];
            let after = edit.target.entry();
            if before != after {
                desired.0[key.slot.index()] = after;
                changes.push(Change {
                    key: edit.physical_key,
                    slot: key.slot,
                    before,
                    after,
                });
            }
        }
        let plan_id = self.next_id("plan");
        let result = json!({"type":"prepared_plan","sessionId":id,"planId":plan_id,"layer":layer,"writes":changes.len(),"expiresInMs":30000,"changes":changes.iter().map(|change|json!({"physicalKey":change.key,"before":Target::from_entry(change.before),"after":Target::from_entry(change.after)})).collect::<Vec<_>>()});
        self.plan = Some(Plan {
            id: plan_id,
            session_id: id.into(),
            generation: session.generation,
            expires_ms: self.scheduler.now().saturating_add(30000),
            layer,
            before: fresh,
            desired,
            changes,
        });
        Ok(result)
    }
    fn restore(&mut self, id: &str, snapshot_id: &str, baseline_hash: &str) -> Result<Value> {
        let session = self.session(id)?;
        let snapshot = self.store.load_snapshot(snapshot_id)?;
        // Parse again to enforce complete bounds/hash, even with another Store implementation.
        let snapshot = Snapshot::parse(&serde_json::to_vec(&snapshot).map_err(|_| INVALID)?)?;
        if snapshot.identity_hash != session.identity.binding_hash()
            || snapshot.capability_id != self.capability.record_id
            || snapshot.layout_id != self.capability.layout_id
            || snapshot.profile != session.profile.wire()
        {
            return Err(Fault::new(
                "incompatible_snapshot",
                "Snapshot identity, layout or current profile does not match",
            ));
        }
        let maps = snapshot.maps()?;
        // v1 plans deliberately contain exactly one fixed layer. Refuse a multi-layer import as a whole.
        if maps.len() != 1 {
            return Err(Fault::new(
                "unsupported_snapshot_scope",
                "Restore requires exactly one scoped layer",
            ));
        }
        let (layer, target) = maps.into_iter().next().ok_or(INVALID)?;
        let current = session.baseline.get(&layer).ok_or(STALE)?;
        let mut edits = Vec::new();
        for slot in 0..SLOTS {
            if current.0[slot] == target.0[slot] {
                continue;
            }
            let key = self
                .capability
                .keys
                .iter()
                .find(|key| key.slot.index() == slot)
                .ok_or(INVALID)?;
            if key.protected {
                return Err(Fault::new(
                    "protected_key",
                    "Restore would alter a protected entry",
                ));
            }
            edits.push(Edit {
                physical_key: key.id.clone(),
                target: Target::from_entry(target.0[slot]).ok_or(Fault::new(
                    "unsupported_target",
                    "Restore cannot recreate an unsupported entry",
                ))?,
            });
        }
        self.prepare(id, layer, baseline_hash, edits)
    }
    fn apply(&mut self, id: &str, plan_id: &str, cancel: &Cancellation) -> Result<Receipt> {
        let session = self.session(id)?;
        let plan = self
            .plan
            .as_ref()
            .filter(|plan| {
                plan.id == plan_id && plan.session_id == id && plan.generation == session.generation
            })
            .cloned()
            .ok_or(Fault::new(
                "invalid_plan",
                "Plan is missing, stale or already consumed",
            ))?;
        self.plan = None; // Consumed before any potentially failing validation or I/O.
        if self.scheduler.now() >= plan.expires_ms {
            return Err(Fault::new(
                "expired_plan",
                "Review expired; prepare a new plan",
            ));
        }
        if !self.capability.write_layers.contains(&plan.layer) {
            return Err(READ_ONLY);
        }
        let mut receipt = Receipt {
            status: "cancelled",
            session_id: id.into(),
            plan_id: plan_id.into(),
            snapshot_id: None,
            attempted: 0,
            verified: 0,
            unknown: 0,
            not_attempted: plan.changes.len(),
            preserved: true,
            readback_complete: false,
            cancelled: cancel.requested(),
            verified_keys: Vec::new(),
            unknown_keys: Vec::new(),
            reason: None,
            mismatches: Vec::new(),
            observed: None,
        };
        if cancel.requested() {
            return Ok(receipt);
        }
        let fresh = self.stable(&session, plan.layer)?;
        if fresh != plan.before {
            return Err(Fault::new(
                "baseline_conflict",
                "Current keymap changed; no mapping writes sent",
            ));
        }
        if self.scheduler.now() >= plan.expires_ms {
            return Err(Fault::new(
                "expired_plan",
                "Review expired during validation",
            ));
        }
        if cancel.requested() {
            receipt.cancelled = true;
            return Ok(receipt);
        }
        if plan.changes.is_empty() {
            receipt.status = "verified";
            return Ok(receipt);
        }
        let snapshot_id = self.next_id("snapshot");
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| STORAGE)?
            .as_millis()
            .try_into()
            .map_err(|_| STORAGE)?;
        let snapshot = Snapshot::new(
            snapshot_id.clone(),
            &session.identity,
            &self.capability,
            session.profile,
            timestamp,
            &BTreeMap::from([(plan.layer, fresh)]),
        );
        let intent = JournalIntent {
            plan_id: plan.id.clone(),
            snapshot_id: snapshot_id.clone(),
            session_id: id.into(),
            baseline_hash: plan.before.hash(),
            desired_hash: plan.desired.hash(),
            changes: plan
                .changes
                .iter()
                .map(|change| JournalChange {
                    physical_key: change.key.clone(),
                    layer: plan.layer,
                    slot: change.slot.wire(),
                    before: change.before.0,
                    after: change.after.0,
                })
                .collect(),
        };
        self.store.save_before(&snapshot, &intent)?;
        receipt.snapshot_id = Some(snapshot_id);
        for change in &plan.changes {
            if cancel.requested() {
                receipt.cancelled = true;
                break;
            }
            // Any wait is inside the owner, then identity/profile are freshly checked.
            if let Err(error) = self
                .scheduler
                .wait_ready()
                .and_then(|_| self.revalidate(&session))
            {
                return Ok(self.uncertain(&plan, receipt, error.code));
            }
            if receipt.attempted == 0 && self.scheduler.now() >= plan.expires_ms {
                return Ok(self.uncertain(&plan, receipt, "expired_plan"));
            }
            if cancel.requested() {
                receipt.cancelled = true;
                break;
            }
            if let Err(error) = self.store.append(
                plan_id,
                &JournalEvent::Sending {
                    physical_key: change.key.clone(),
                },
            ) {
                return Ok(self.uncertain(&plan, receipt, error.code));
            }
            // Final cancellation check is adjacent to the single transport send; cancellation racing the send is conservatively post-send.
            if cancel.requested() {
                receipt.cancelled = true;
                if let Err(error) = self.store.append(
                    plan_id,
                    &JournalEvent::NotSent {
                        physical_key: change.key.clone(),
                    },
                ) {
                    return Ok(self.uncertain(&plan, receipt, error.code));
                }
                break;
            }
            receipt.attempted += 1;
            receipt.not_attempted -= 1;
            if let Err(error) = self.scheduler.execute(Operation::WriteSlot {
                layer: plan.layer,
                profile: session.profile,
                slot: change.slot,
                entry: change.after,
            }) {
                return Ok(self.uncertain(&plan, receipt, error.code));
            }
            if let Err(error) = self.store.append(
                plan_id,
                &JournalEvent::Sent {
                    physical_key: change.key.clone(),
                },
            ) {
                return Ok(self.uncertain(&plan, receipt, error.code));
            }
        }
        if receipt.attempted == 0 {
            receipt.status = "cancelled";
            receipt.cancelled = true;
        } else {
            self.scheduler.settle();
            let actual = match self.stable(&session, plan.layer) {
                Ok(map) => map,
                Err(error) => return Ok(self.uncertain(&plan, receipt, error.code)),
            };
            receipt.readback_complete = true;
            receipt.observed = Some(actual.clone());
            let changed_slots: BTreeSet<usize> = plan
                .changes
                .iter()
                .take(receipt.attempted)
                .map(|change| change.slot.index())
                .collect();
            receipt.preserved = (0..SLOTS)
                .filter(|slot| !changed_slots.contains(slot))
                .all(|slot| actual.0[slot] == plan.before.0[slot]);
            receipt.verified_keys = plan
                .changes
                .iter()
                .take(receipt.attempted)
                .filter(|change| actual.0[change.slot.index()] == change.after)
                .map(|change| change.key.clone())
                .collect();
            receipt.verified = receipt.verified_keys.len();
            receipt.mismatches = plan
                .changes
                .iter()
                .take(receipt.attempted)
                .filter(|change| actual.0[change.slot.index()] != change.after)
                .map(|change| {
                    let observed = actual.0[change.slot.index()];
                    MappingMismatch {
                        physical_key: change.key.clone(),
                        expected: Target::from_entry(change.after),
                        actual: Target::from_entry(observed),
                        actual_unsupported: Target::from_entry(observed).is_none(),
                        changed_from_original: observed != change.before,
                    }
                })
                .collect();
            let all_original = plan
                .changes
                .iter()
                .take(receipt.attempted)
                .all(|change| actual.0[change.slot.index()] == change.before);
            receipt.status = if !receipt.cancelled && actual == plan.desired && receipt.preserved {
                "verified"
            } else if all_original && receipt.preserved {
                "rejected"
            } else {
                "partial"
            };
            if !receipt.preserved {
                receipt.reason = Some("preservation_mismatch");
            } else if !receipt.mismatches.is_empty() {
                receipt.reason = Some("mapping_mismatch");
            }
            if receipt.status == "verified" {
                if let Some(session) = self.session.as_mut() {
                    session.baseline.insert(plan.layer, actual);
                }
            } else {
                self.invalidate();
            }
        }
        self.scheduler.settle();
        if self
            .store
            .append(plan_id, &journal_outcome(&receipt))
            .is_err()
        {
            return Ok(self.uncertain(&plan, receipt, "journal_finish_failed"));
        }
        Ok(receipt)
    }
    fn uncertain(&mut self, plan: &Plan, mut receipt: Receipt, reason: &'static str) -> Receipt {
        // After an error there is NO further wire traffic, including recovery queries.
        receipt.status = if receipt.attempted == 0 {
            "rejected"
        } else {
            "uncertain"
        };
        receipt.reason = Some(reason);
        // Keep observed read-back facts even if the final durable receipt fails.
        if !receipt.readback_complete {
            receipt.verified = 0;
            receipt.verified_keys.clear();
            receipt.unknown = receipt.attempted;
            receipt.unknown_keys = plan
                .changes
                .iter()
                .take(receipt.attempted)
                .map(|change| change.key.clone())
                .collect();
            if receipt.attempted > 0 {
                receipt.preserved = false;
            }
        }
        self.scheduler.settle();
        self.invalidate();
        let _ = self
            .store
            .append(&receipt.plan_id, &journal_outcome(&receipt));
        receipt
    }
    pub(crate) fn handle(&mut self, command: Command, cancel: &Cancellation) -> Result<Value> {
        match command {
            Command::ReadCurrentKeymap { session_id, layer } => {
                self.read_current(&session_id, layer)
            }
            Command::PrepareChanges {
                session_id,
                baseline_hash,
                layer,
                changes,
            } => self.prepare(&session_id, layer, &baseline_hash, changes),
            Command::ApplyPreparedPlan {
                session_id,
                plan_id,
            } => Ok(
                json!({"type":"apply_receipt","receipt":self.apply(&session_id,&plan_id,cancel)?}),
            ),
            Command::StageSnapshotRestore {
                session_id,
                snapshot_id,
                baseline_hash,
            } => self.restore(&session_id, &snapshot_id, &baseline_hash),
            Command::CancelPendingApply {
                session_id,
                plan_id,
            } => {
                self.session(&session_id)?;
                if self.plan.as_ref().is_some_and(|plan| plan.id == plan_id) {
                    self.plan = None;
                    Ok(json!({"type":"cancelled","writes":0}))
                } else {
                    Err(Fault::new("invalid_plan", "No pending plan matches"))
                }
            }
            Command::Disconnect { session_id } => {
                self.session(&session_id)?;
                self.invalidate();
                Ok(json!({"type":"disconnected"}))
            }
            _ => Err(INVALID),
        }
    }
}

fn journal_outcome(receipt: &Receipt) -> JournalEvent {
    JournalEvent::Finished {
        status: receipt.status.into(),
        verified_keys: receipt.verified_keys.clone(),
        unknown_keys: receipt.unknown_keys.clone(),
        not_attempted: receipt.not_attempted,
        preserved: receipt.preserved,
        readback_complete: receipt.readback_complete,
        readback_hex: receipt.observed.as_ref().map(Keymap::hex),
        cancelled: receipt.cancelled,
        reason: receipt.reason.map(str::to_string),
    }
}
