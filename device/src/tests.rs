use crate::{
    domain::*,
    engine::{Cancellation, Engine},
    ipc,
    protocol::{
        Clock, Framing, Operation, ReadOnlyTransport, ReadOperation, ReadTransport, Scheduler,
        Transport, TransportError, WireReply,
    },
    storage::{FsStore, JournalEvent, JournalIntent, Store},
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
    path::PathBuf,
    rc::Rc,
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Clone, Debug)]
struct Trace {
    packet: [u8; 64],
    started: u64,
    completed: u64,
}
struct FakeState {
    interface: Interface,
    interface_error: Option<TransportError>,
    id: u32,
    revision: u32,
    profile: u8,
    map: Keymap,
    trace: Vec<Trace>,
    pages: usize,
    bad_page_length: Option<usize>,
    unstable_at_page: Option<usize>,
    fault_write: Option<usize>,
    write_count: usize,
    ignored_write: bool,
    corrupt_neighbor: bool,
    corrupt_target: Option<Entry>,
    accept_then_timeout: bool,
    latency_ms: u64,
    cancel_after_write: Option<(usize, Cancellation)>,
    prefixed: bool,
}
#[derive(Clone)]
struct Fake {
    state: Rc<RefCell<FakeState>>,
    time: Rc<Cell<u64>>,
}
#[derive(Clone)]
struct FakeClock(Rc<Cell<u64>>);
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
    fn sleep_until(&mut self, deadline: u64) {
        self.0.set(self.0.get().max(deadline));
    }
}
impl Transport for Fake {
    fn interface(&self) -> std::result::Result<Interface, TransportError> {
        let state = self.state.borrow();
        match state.interface_error {
            Some(error) => Err(error),
            None => Ok(state.interface.clone()),
        }
    }
    fn exchange(
        &mut self,
        operation: Operation,
    ) -> std::result::Result<Option<WireReply>, TransportError> {
        let packet = operation.packet().map_err(|_| TransportError::Protocol)?;
        let expects_reply = !operation.is_write();
        let mut state = self.state.borrow_mut();
        let started = self.time.get();
        self.time.set(started + state.latency_ms);
        let completed = self.time.get();
        state.trace.push(Trace {
            packet,
            started,
            completed,
        });
        // Independent device model: parse on-wire bytes, never use the encoder or planned result.
        assert_eq!(
            packet[..8].iter().map(|byte| u32::from(*byte)).sum::<u32>() & 255,
            255
        );
        let mut reply = vec![0_u8; 64];
        match packet[0] {
            0x8f => {
                reply[0] = 0x8f;
                reply[1..5].copy_from_slice(&state.id.to_le_bytes());
            }
            0x80 => {
                reply[0] = 0x80;
                reply[1..5].copy_from_slice(&state.revision.to_le_bytes());
            }
            0x85 => {
                reply[0] = 0x85;
                reply[1] = state.profile;
            }
            0x89 | 0x90 => {
                assert!(expects_reply);
                assert_eq!(packet[1], state.profile);
                assert!(packet[2] < 8);
                let bytes = state.map.bytes();
                let offset = usize::from(packet[2]) * 64;
                reply.copy_from_slice(&bytes[offset..offset + 64]);
                state.pages += 1;
                if state.unstable_at_page == Some(state.pages) {
                    reply[0] ^= 1;
                }
                if let Some(length) = state.bad_page_length {
                    reply.resize(length, 0);
                }
            }
            0x13 | 0x15 => {
                assert!(!expects_reply);
                assert_eq!(packet[1], state.profile);
                assert!(packet[2] < 128);
                state.write_count += 1;
                let faults = state.fault_write == Some(state.write_count);
                if !state.ignored_write && (!faults || state.accept_then_timeout) {
                    state.map.0[usize::from(packet[2])]
                        .0
                        .copy_from_slice(&packet[8..12]);
                }
                if let Some(entry) = state.corrupt_target {
                    state.map.0[usize::from(packet[2])] = entry;
                }
                if state.corrupt_neighbor {
                    state.map.0[127] = Entry([0xfa, 0x55, 0x44, 0x33]);
                }
                if let Some((count, token)) = &state.cancel_after_write
                    && *count == state.write_count
                {
                    token.cancel();
                }
                if faults {
                    return Err(if state.accept_then_timeout {
                        TransportError::Timeout
                    } else {
                        TransportError::Stall
                    });
                }
                return Ok(None);
            }
            other => panic!("Unallowlisted opcode reached fake: {other:02x}"),
        }
        let framing = if state.prefixed {
            reply.insert(0, 0);
            Framing::ReportIdPrefix
        } else {
            Framing::Payload
        };
        Ok(Some(WireReply {
            bytes: reply,
            framing,
        }))
    }
}
#[derive(Default)]
struct Evidence {
    snapshots: BTreeMap<String, Snapshot>,
    events: Vec<JournalEvent>,
    fail_save: bool,
    fail_append: Option<usize>,
    appends: usize,
}
#[derive(Clone, Default)]
struct MemoryStore(Rc<RefCell<Evidence>>);
impl Store for MemoryStore {
    fn save_before(&mut self, snapshot: &Snapshot, intent: &JournalIntent) -> Result<()> {
        let mut evidence = self.0.borrow_mut();
        if evidence.fail_save {
            return Err(STORAGE);
        }
        Snapshot::parse(&serde_json::to_vec(snapshot).unwrap())?;
        evidence
            .snapshots
            .insert(snapshot.snapshot_id.clone(), snapshot.clone());
        evidence.events.push(JournalEvent::Prepared {
            intent: intent.clone(),
        });
        Ok(())
    }
    fn append(&mut self, _: &str, event: &JournalEvent) -> Result<()> {
        let mut evidence = self.0.borrow_mut();
        evidence.appends += 1;
        if evidence.fail_append == Some(evidence.appends) {
            return Err(STORAGE);
        }
        evidence.events.push(event.clone());
        Ok(())
    }
    fn load_snapshot(&self, id: &str) -> Result<Snapshot> {
        self.0.borrow().snapshots.get(id).cloned().ok_or(STORAGE)
    }
}
type Owner = Engine<Fake, FakeClock, MemoryStore>;
fn capability() -> Capability {
    Capability {
        record_id: "test-only-never-shipped".into(),
        layout_id: "fixture-layout-v1".into(),
        identity: Identity {
            interface: Interface {
                instance: "fake-interface-1".into(),
                vid: 0x3151,
                pid: 0x4015,
                usage_page: 0xffff,
                usage: 2,
                descriptor_hash: "d".repeat(64),
                report_id: 0,
                payload_bytes: 64,
                link: Link::DirectUsb,
                mode: "fixture-usb-win".into(),
            },
            internal_id: 1694,
            revision: 42,
        },
        profiles: BTreeSet::from([4]),
        read_layers: BTreeSet::from([Layer::Base]),
        write_layers: BTreeSet::from([Layer::Base]),
        keys: vec![
            PhysicalKey {
                id: "caps-lock".into(),
                slot: Slot::new(7).unwrap(),
                protected: false,
            },
            PhysicalKey {
                id: "key-a".into(),
                slot: Slot::new(11).unwrap(),
                protected: false,
            },
            PhysicalKey {
                id: "fn".into(),
                slot: Slot::new(12).unwrap(),
                protected: true,
            },
            PhysicalKey {
                id: "unknown".into(),
                slot: Slot::new(13).unwrap(),
                protected: false,
            },
        ],
        evidence: "Synthetic library-test evidence, not actual hardware".into(),
    }
}
fn parts(cap: &Capability) -> (Fake, FakeClock, MemoryStore) {
    let time = Rc::new(Cell::new(0));
    let mut map = Keymap([Entry([0, 0, 4, 0]); 128]);
    map.0[7] = Target::CapsLock.entry();
    map.0[13] = Entry([0x99, 0xfe, 0x88, 0x66]);
    let state = FakeState {
        interface: cap.identity.interface.clone(),
        interface_error: None,
        id: cap.identity.internal_id,
        revision: cap.identity.revision,
        profile: 4,
        map,
        trace: vec![],
        pages: 0,
        bad_page_length: None,
        unstable_at_page: None,
        fault_write: None,
        write_count: 0,
        ignored_write: false,
        corrupt_neighbor: false,
        corrupt_target: None,
        accept_then_timeout: false,
        latency_ms: 3,
        cancel_after_write: None,
        prefixed: false,
    };
    (
        Fake {
            state: Rc::new(RefCell::new(state)),
            time: time.clone(),
        },
        FakeClock(time),
        MemoryStore::default(),
    )
}
fn setup() -> (Owner, String, String) {
    let cap = capability();
    let (fake, clock, store) = parts(&cap);
    let mut engine = Engine::new(fake, clock, store, cap, "test-nonce".into()).unwrap();
    let session = engine.connect().unwrap();
    let baseline = read(&mut engine, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .into();
    (engine, session, baseline)
}
fn call<T: Transport, C: Clock, S: Store>(
    owner: &mut Engine<T, C, S>,
    command: Value,
    cancel: &Cancellation,
) -> Result<Value> {
    let frame = serde_json::to_vec(&json!({"v":1,"id":"test-request","command":command})).unwrap();
    let request = ipc::parse(&frame)?;
    owner.handle(request.command, cancel)
}
fn read<T: Transport, C: Clock, S: Store>(owner: &mut Engine<T, C, S>, session: &str) -> Value {
    call(
        owner,
        json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
        &Cancellation::default(),
    )
    .unwrap()
}
fn prepare(owner: &mut Owner, session: &str, baseline: &str, changes: Value) -> Value {
    call(owner,json!({"type":"prepare_changes","sessionId":session,"baselineHash":baseline,"layer":"base","changes":changes}),&Cancellation::default()).unwrap()
}
fn one_plan(owner: &mut Owner, session: &str, baseline: &str) -> String {
    prepare(
        owner,
        session,
        baseline,
        json!([{"physicalKey":"caps-lock","target":"escape"}]),
    )["planId"]
        .as_str()
        .unwrap()
        .into()
}
fn apply<T: Transport, C: Clock, S: Store>(
    owner: &mut Engine<T, C, S>,
    session: &str,
    plan: &str,
    cancel: &Cancellation,
) -> Result<Value> {
    call(
        owner,
        json!({"type":"apply_prepared_plan","sessionId":session,"planId":plan}),
        cancel,
    )
}
fn writes(owner: &Owner) -> Vec<Trace> {
    owner
        .scheduler
        .transport
        .state
        .borrow()
        .trace
        .iter()
        .filter(|trace| matches!(trace.packet[0], 0x13 | 0x15))
        .cloned()
        .collect()
}
fn receipt(value: &Value) -> &Value {
    &value["receipt"]
}

#[test]
fn worker_handshake_is_honest_and_all_hardware_intents_are_closed() {
    let input=[json!({"v":1,"id":"hello","command":{"type":"hello"}}),json!({"v":1,"id":"list","command":{"type":"list_candidates"}}),json!({"v":1,"id":"apply","command":{"type":"apply_prepared_plan","sessionId":"fake","planId":"fake"}})].into_iter().map(|v|format!("{v}\n")).collect::<String>();
    let mut output = Vec::new();
    crate::run(Cursor::new(input), &mut output).unwrap();
    let replies: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies[0]["result"]["hardwareAccess"], false);
    assert_eq!(replies[0]["result"]["mode"], "no_hardware");
    assert_eq!(replies[1]["result"]["candidates"], json!([]));
    assert_eq!(replies[2]["error"]["code"], "hardware_unavailable");
}
#[test]
fn strict_ipc_blocks_unknown_fields_raw_bytes_profiles_and_later_invalid_targets() {
    for command in [
        json!({"type":"hello","opcode":19}),
        json!({"type":"raw","bytes":[19,4,7]}),
        json!({"type":"read_current_keymap","sessionId":"s","layer":"rgb"}),
        json!({"type":"prepare_changes","sessionId":"s","baselineHash":"0".repeat(64),"layer":"base","profile":4,"changes":[]}),
        json!({"type":"prepare_changes","sessionId":"s","baselineHash":"0".repeat(64),"layer":"base","changes":[{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"key-a","target":231}]}),
    ] {
        assert!(
            ipc::parse(&serde_json::to_vec(&json!({"v":1,"id":"x","command":command})).unwrap())
                .is_err()
        );
    }
    assert!(ipc::parse(br#"{"v":1,"v":1,"id":"x","command":{"type":"hello"}}"#).is_err());
    assert!(ipc::parse(br#"{"v":2,"id":"x","command":{"type":"hello"}}"#).is_err());
}
#[test]
fn bounded_pipe_rejects_flood_overflow_and_duplicate_ids() {
    let mut output = Vec::new();
    let mut input = vec![b' '; MAX_FRAME + 1];
    input.extend_from_slice(b"\n{\"v\":1,\"id\":\"hi\",\"command\":{\"type\":\"hello\"}}\n");
    crate::run(Cursor::new(input), &mut output).unwrap();
    assert_eq!(output.iter().filter(|b| **b == b'\n').count(), 1);
    assert!(
        String::from_utf8(output)
            .unwrap()
            .contains("frame_too_large")
    );
    let frame = "{\"v\":1,\"id\":\"hello\",\"command\":{\"type\":\"hello\"}}\n";
    let mut output = Vec::new();
    crate::run(Cursor::new(frame.repeat(4097)), &mut output).unwrap();
    let text = String::from_utf8(output).unwrap();
    assert!(text.contains("duplicate_request"));
    assert_eq!(text.lines().count(), 4097);
    assert!(text.lines().last().unwrap().contains("request_limit"));
}
#[test]
fn parser_never_panics_on_deterministic_arbitrary_bounded_frames() {
    let mut seed = 0xa1b2c3d4_u64;
    for length in 0..2048 {
        let mut bytes = Vec::with_capacity(length);
        for _ in 0..length {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            bytes.push(seed as u8);
        }
        let _ = ipc::parse(&bytes);
        let _ = Snapshot::parse(&bytes);
    }
}
#[test]
fn candidate_read_only_has_no_write_plan_or_wire_report() {
    let mut cap = capability();
    cap.write_layers.clear();
    let (fake, clock, store) = parts(&cap);
    let mut owner = Engine::new(fake, clock, store, cap, "candidate".into()).unwrap();
    let session = owner.connect().unwrap();
    let hash = read(&mut owner, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .to_string();
    let error=call(&mut owner,json!({"type":"prepare_changes","sessionId":session,"baselineHash":hash,"layer":"base","changes":[{"physicalKey":"caps-lock","target":"escape"}]}),&Cancellation::default()).unwrap_err();
    assert_eq!(error.code, "read_only");
    assert!(writes(&owner).is_empty());
    assert!(
        apply(
            &mut owner,
            &session,
            "forged-plan",
            &Cancellation::default()
        )
        .is_err()
    );
    assert!(writes(&owner).is_empty());
}

#[test]
fn read_scheduler_and_transport_signatures_keep_operation_types() {
    // These assignments are compile-time regressions: widening read() back to
    // Operation, or transport exchange back to raw bytes + a flag, fails to build.
    let _: fn(&mut Scheduler<Fake, FakeClock>, ReadOperation) -> Result<[u8; 64]> = Scheduler::read;
    let _: fn(&mut Fake, Operation) -> std::result::Result<Option<WireReply>, TransportError> =
        <Fake as Transport>::exchange;
}

#[test]
fn read_only_adapter_refuses_direct_writes_before_any_backend_dispatch() {
    struct QueryOnly {
        fake: Fake,
        calls: Rc<Cell<usize>>,
    }
    impl ReadTransport for QueryOnly {
        fn interface(&self) -> std::result::Result<Interface, TransportError> {
            self.fake.interface()
        }
        fn read(
            &mut self,
            operation: ReadOperation,
        ) -> std::result::Result<WireReply, TransportError> {
            self.calls.set(self.calls.get() + 1);
            self.fake
                .exchange(Operation::Read(operation))?
                .ok_or(TransportError::Protocol)
        }
    }
    let _: fn(&mut QueryOnly, ReadOperation) -> std::result::Result<WireReply, TransportError> =
        <QueryOnly as ReadTransport>::read;
    let cap = capability();
    let (fake, clock, _) = parts(&cap);
    let state = fake.state.clone();
    let before = state.borrow().map.clone();
    let calls = Rc::new(Cell::new(0));
    let mut transport = ReadOnlyTransport::new(QueryOnly {
        fake,
        calls: calls.clone(),
    });
    let profile = Profile::observed(4).unwrap();
    for layer in [Layer::Base, Layer::Fn] {
        let error = transport
            .exchange(Operation::WriteSlot {
                layer,
                profile,
                slot: Slot::new(7).unwrap(),
                entry: Target::Escape.entry(),
            })
            .unwrap_err();
        assert_eq!(error, TransportError::ReadOnly);
        assert_eq!(error.fault(), READ_ONLY);
    }
    // Even calls that bypass the scheduler cannot forward invalid page values.
    for page in [8, 255] {
        assert_eq!(
            transport
                .exchange(Operation::Read(ReadOperation::ReadPage {
                    layer: Layer::Base,
                    profile,
                    page,
                }))
                .unwrap_err(),
            TransportError::Protocol
        );
    }
    assert_eq!(calls.get(), 0);
    assert!(state.borrow().trace.is_empty());
    assert_eq!(transport.interface().unwrap(), cap.identity.interface);
    assert!(state.borrow().trace.is_empty());

    let mut scheduler = Scheduler::new(transport, clock, cap.identity.interface.clone());
    let identify = scheduler.read(ReadOperation::Identify).unwrap();
    assert_eq!(identify[0], 0x8f);
    assert_eq!(
        u32::from_le_bytes(identify[1..5].try_into().unwrap()),
        cap.identity.internal_id
    );
    assert_eq!(calls.get(), 1);
    assert_eq!(state.borrow().trace.len(), 1);
    assert_eq!(state.borrow().write_count, 0);
    assert_eq!(state.borrow().map, before);

    // The combined scheduler/adapter path also fails closed, with no extra
    // native-facing read or packet, and poisons this scheduler lifetime.
    assert_eq!(
        scheduler
            .execute(Operation::WriteSlot {
                layer: Layer::Base,
                profile,
                slot: Slot::new(7).unwrap(),
                entry: Target::Escape.entry(),
            })
            .unwrap_err(),
        READ_ONLY
    );
    assert_eq!(scheduler.read(ReadOperation::Identify).unwrap_err(), STALE);
    assert_eq!(calls.get(), 1);
    assert_eq!(state.borrow().trace.len(), 1);
    assert_eq!(state.borrow().write_count, 0);
    assert_eq!(state.borrow().map, before);
}

#[test]
fn typed_read_operations_match_independent_wire_fixtures_without_writes() {
    let cap = capability();
    let (fake, clock, _) = parts(&cap);
    let before = fake.state.borrow().map.clone();
    let mut scheduler = Scheduler::new(fake, clock, cap.identity.interface.clone());
    let profile = Profile::observed(4).unwrap();
    // Independent, synthetic reference headers. No expected byte is generated
    // by Operation::packet; these are not captures from a physical keyboard.
    let fixtures = [
        (ReadOperation::Identify, [0x8f, 0, 0, 0, 0, 0, 0, 0x70]),
        (ReadOperation::Revision, [0x80, 0, 0, 0, 0, 0, 0, 0x7f]),
        (
            ReadOperation::CurrentProfile,
            [0x85, 0, 0, 0, 0, 0, 0, 0x7a],
        ),
        (
            ReadOperation::ReadPage {
                layer: Layer::Base,
                profile,
                page: 0,
            },
            [0x89, 4, 0, 0, 0, 0, 0, 0x72],
        ),
        (
            ReadOperation::ReadPage {
                layer: Layer::Base,
                profile,
                page: 7,
            },
            [0x89, 4, 7, 0, 0, 0, 0, 0x6b],
        ),
        (
            ReadOperation::ReadPage {
                layer: Layer::Fn,
                profile,
                page: 0,
            },
            [0x90, 4, 0, 0, 0, 0, 0, 0x6b],
        ),
        (
            ReadOperation::ReadPage {
                layer: Layer::Fn,
                profile,
                page: 7,
            },
            [0x90, 4, 7, 0, 0, 0, 0, 0x64],
        ),
    ];
    for (operation, header) in fixtures {
        scheduler.read(operation).unwrap();
        let state = scheduler.transport.state.borrow();
        let packet = state.trace.last().unwrap().packet;
        assert_eq!(&packet[..8], &header);
        assert_eq!(&packet[8..], &[0; 56]);
    }
    let state = scheduler.transport.state.borrow();
    assert_eq!(state.trace.len(), fixtures.len());
    assert_eq!(state.write_count, 0);
    assert_eq!(state.map, before);
    assert!(
        state
            .trace
            .windows(2)
            .all(|pair| pair[1].started >= pair[0].completed + 8)
    );
}

#[test]
fn invalid_read_page_is_rejected_before_typed_transport() {
    let cap = capability();
    let (fake, clock, _) = parts(&cap);
    let mut scheduler = Scheduler::new(fake, clock, cap.identity.interface.clone());
    for page in [8, 255] {
        let error = scheduler
            .read(ReadOperation::ReadPage {
                layer: Layer::Base,
                profile: Profile::observed(4).unwrap(),
                page,
            })
            .unwrap_err();
        assert_eq!(error.code, "invalid_page");
    }
    assert!(scheduler.transport.state.borrow().trace.is_empty());
    assert_eq!(scheduler.transport.state.borrow().write_count, 0);
}

#[test]
fn typed_transport_reply_mismatch_still_poisons_scheduler() {
    struct WrongReply(Fake);
    impl Transport for WrongReply {
        fn interface(&self) -> std::result::Result<Interface, TransportError> {
            self.0.interface()
        }
        fn exchange(
            &mut self,
            operation: Operation,
        ) -> std::result::Result<Option<WireReply>, TransportError> {
            self.0.exchange(operation)?;
            Ok(if operation.is_write() {
                Some(WireReply {
                    bytes: vec![0; 64],
                    framing: Framing::Payload,
                })
            } else {
                None
            })
        }
    }
    for operation in [
        Operation::Read(ReadOperation::Identify),
        Operation::WriteSlot {
            layer: Layer::Base,
            profile: Profile::observed(4).unwrap(),
            slot: Slot::new(7).unwrap(),
            entry: Target::Escape.entry(),
        },
    ] {
        let cap = capability();
        let (fake, clock, _) = parts(&cap);
        let mut scheduler = Scheduler::new(WrongReply(fake), clock, cap.identity.interface.clone());
        assert_eq!(
            scheduler.execute(operation).unwrap_err().code,
            "unexpected_reply"
        );
        assert_eq!(scheduler.read(ReadOperation::Identify).unwrap_err(), STALE);
        assert_eq!(scheduler.transport.0.state.borrow().trace.len(), 1);
        if operation.is_write() {
            let completed = scheduler.transport.0.state.borrow().trace[0].completed;
            scheduler.settle();
            assert!(scheduler.now() >= completed + 2000);
        }
    }
}

#[test]
fn independent_wire_fixture_minimal_diff_preserves_every_other_byte() {
    let (mut owner, session, hash) = setup();
    let before = owner.scheduler.transport.state.borrow().map.clone();
    let plan = one_plan(&mut owner, &session, &hash);
    let result = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    assert_eq!(receipt(&result)["status"], "verified");
    let wire = writes(&owner);
    assert_eq!(wire.len(), 1);
    let mut expected = [0; 64];
    expected[0] = 0x13;
    expected[1] = 4;
    expected[2] = 7;
    expected[7] = 0xe1;
    expected[10] = 0x29;
    assert_eq!(wire[0].packet, expected);
    let after = &owner.scheduler.transport.state.borrow().map;
    for slot in 0..128 {
        if slot != 7 {
            assert_eq!(before.0[slot], after.0[slot]);
        }
    }
    assert_eq!(after.0[7], Entry([0, 0, 0x29, 0]));
}
#[test]
fn no_op_has_zero_writes_and_consumed_plans_cannot_replay() {
    let (mut owner, session, hash) = setup();
    let result = prepare(
        &mut owner,
        &session,
        &hash,
        json!([{"physicalKey":"caps-lock","target":"caps_lock"}]),
    );
    assert_eq!(result["writes"], 0);
    let plan = result["planId"].as_str().unwrap();
    assert_eq!(
        receipt(&apply(&mut owner, &session, plan, &Cancellation::default()).unwrap())["status"],
        "verified"
    );
    assert!(apply(&mut owner, &session, plan, &Cancellation::default()).is_err());
    assert!(writes(&owner).is_empty());
}
#[test]
fn duplicate_apply_after_real_send_never_repeats() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    let error = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap_err();
    assert_eq!(error.code, "invalid_plan");
    assert_eq!(writes(&owner).len(), 1);
}
#[test]
fn whole_draft_rejects_duplicate_protected_unknown_and_unmapped_keys() {
    for changes in [
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"caps-lock","target":"a"}]),
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"fn","target":"a"}]),
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"unknown","target":"a"}]),
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"slot-127","target":"a"}]),
    ] {
        let (mut owner, session, hash) = setup();
        assert!(call(&mut owner,json!({"type":"prepare_changes","sessionId":session,"baselineHash":hash,"layer":"base","changes":changes}),&Cancellation::default()).is_err());
        assert!(writes(&owner).is_empty());
    }
}
#[test]
fn stale_map_identity_profile_revision_descriptor_and_instance_fail_before_writes() {
    for kind in 0..6 {
        let (mut owner, session, hash) = setup();
        let plan = one_plan(&mut owner, &session, &hash);
        {
            let mut state = owner.scheduler.transport.state.borrow_mut();
            match kind {
                0 => state.map.0[5] = Target::Z.entry(),
                1 => state.id += 1,
                2 => state.profile = 3,
                3 => state.revision += 1,
                4 => state.interface.descriptor_hash = "0".repeat(64),
                _ => state.interface.instance = "replacement".into(),
            }
        }
        assert!(apply(&mut owner, &session, &plan, &Cancellation::default()).is_err());
        assert!(writes(&owner).is_empty());
    }
}
#[test]
fn session_plan_binding_and_expiry_fail_closed() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    assert!(
        apply(
            &mut owner,
            "different-session",
            &plan,
            &Cancellation::default()
        )
        .is_err()
    );
    owner
        .scheduler
        .clock
        .0
        .set(owner.scheduler.clock.0.get() + 30_000);
    assert_eq!(
        apply(&mut owner, &session, &plan, &Cancellation::default())
            .unwrap_err()
            .code,
        "expired_plan"
    );
    assert!(writes(&owner).is_empty());
}
#[test]
fn exact_page_lengths_and_two_sweeps_are_required() {
    for length in [0, 8, 63, 65, 128] {
        let (mut owner, session, _) = setup();
        owner.scheduler.transport.state.borrow_mut().bad_page_length = Some(length);
        let result = call(
            &mut owner,
            json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
            &Cancellation::default(),
        );
        assert_eq!(result.unwrap_err().code, "invalid_reply_length");
        assert!(writes(&owner).is_empty());
    }
    let (mut owner, session, _) = setup();
    {
        let mut state = owner.scheduler.transport.state.borrow_mut();
        state.unstable_at_page = Some(state.pages + 9);
    }
    let error = call(
        &mut owner,
        json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
        &Cancellation::default(),
    )
    .unwrap_err();
    assert_eq!(error.code, "unstable_read");
}
#[test]
fn report_id_prefix_is_normalized_without_inventing_bytes() {
    let (mut owner, session, hash) = setup();
    owner.scheduler.transport.state.borrow_mut().prefixed = true;
    assert_eq!(read(&mut owner, &session)["baselineHash"], hash);
    for length in [0, 64, 66] {
        assert!(
            WireReply {
                bytes: vec![0; length],
                framing: Framing::ReportIdPrefix
            }
            .exact_payload()
            .is_err()
        );
    }
    let mut bytes = vec![0; 65];
    bytes[0] = 1;
    assert!(
        WireReply {
            bytes,
            framing: Framing::ReportIdPrefix
        }
        .exact_payload()
        .is_err()
    );
}
#[test]
fn storage_and_journal_failures_block_first_write() {
    for fail_append in [false, true] {
        let (mut owner, session, hash) = setup();
        let plan = one_plan(&mut owner, &session, &hash);
        if fail_append {
            owner.store.0.borrow_mut().fail_append = Some(1);
        } else {
            owner.store.0.borrow_mut().fail_save = true;
        }
        let result = apply(&mut owner, &session, &plan, &Cancellation::default());
        if fail_append {
            assert_eq!(receipt(&result.unwrap())["status"], "rejected");
        } else {
            assert_eq!(result.unwrap_err().code, "storage_failed");
        }
        assert!(writes(&owner).is_empty());
    }
}
#[test]
fn wire_pacing_uses_actual_completion_even_with_slow_transport() {
    let (mut owner, session, hash) = setup();
    owner.scheduler.transport.state.borrow_mut().latency_ms = 400;
    let result = prepare(
        &mut owner,
        &session,
        &hash,
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"key-a","target":"z"}]),
    );
    let plan = result["planId"].as_str().unwrap();
    let result = apply(&mut owner, &session, plan, &Cancellation::default()).unwrap();
    assert_eq!(receipt(&result)["status"], "verified");
    let state = owner.scheduler.transport.state.borrow();
    let mut last_write = None;
    for trace in &state.trace {
        if let Some(completed) = last_write {
            assert!(trace.started >= completed + 1000);
        }
        if trace.packet[0] == 0x13 {
            last_write = Some(trace.completed);
        } else {
            last_write = None;
        }
    }
    let writes: Vec<_> = state
        .trace
        .iter()
        .filter(|trace| trace.packet[0] == 0x13)
        .collect();
    assert!(writes[1].started >= writes[0].completed + 1000);
    let after_last = state
        .trace
        .iter()
        .find(|trace| trace.started > writes[1].completed)
        .unwrap();
    assert!(after_last.started >= writes[1].completed + 2000);
}
#[test]
fn stalls_and_ambiguous_accepted_timeouts_stop_all_further_traffic() {
    for accepted in [false, true] {
        let (mut owner, session, hash) = setup();
        let prepared = prepare(
            &mut owner,
            &session,
            &hash,
            json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"key-a","target":"z"}]),
        );
        {
            let mut state = owner.scheduler.transport.state.borrow_mut();
            state.fault_write = Some(1);
            state.accept_then_timeout = accepted;
        }
        let value = apply(
            &mut owner,
            &session,
            prepared["planId"].as_str().unwrap(),
            &Cancellation::default(),
        )
        .unwrap();
        assert_eq!(receipt(&value)["status"], "uncertain");
        assert_eq!(receipt(&value)["unknown"], 1);
        assert_eq!(receipt(&value)["notAttempted"], 1);
        let state = owner.scheduler.transport.state.borrow();
        assert_eq!(state.trace.last().unwrap().packet[0], 0x13);
        assert_eq!(state.write_count, 1);
        assert_eq!(
            state.map.0[7],
            if accepted {
                Target::Escape.entry()
            } else {
                Target::CapsLock.entry()
            }
        );
    }
}
#[test]
fn readback_rejection_and_neighbor_corruption_are_not_success() {
    for corrupt in [false, true] {
        let (mut owner, session, hash) = setup();
        let plan = one_plan(&mut owner, &session, &hash);
        {
            let mut state = owner.scheduler.transport.state.borrow_mut();
            state.ignored_write = !corrupt;
            state.corrupt_neighbor = corrupt;
        }
        let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
        assert_eq!(
            receipt(&value)["status"],
            if corrupt { "partial" } else { "rejected" }
        );
        assert_eq!(receipt(&value)["preserved"], !corrupt);
        assert_eq!(writes(&owner).len(), 1);
    }
}
#[test]
fn cancellation_before_send_and_mid_plan_is_scoped_not_rollback() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    let cancel = Cancellation::default();
    cancel.cancel();
    let value = apply(&mut owner, &session, &plan, &cancel).unwrap();
    assert_eq!(receipt(&value)["status"], "cancelled");
    assert!(writes(&owner).is_empty());
    let (mut owner, session, hash) = setup();
    let prepared = prepare(
        &mut owner,
        &session,
        &hash,
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"key-a","target":"z"}]),
    );
    let cancel = Cancellation::default();
    owner
        .scheduler
        .transport
        .state
        .borrow_mut()
        .cancel_after_write = Some((1, cancel.clone()));
    let value = apply(
        &mut owner,
        &session,
        prepared["planId"].as_str().unwrap(),
        &cancel,
    )
    .unwrap();
    assert_eq!(receipt(&value)["status"], "partial");
    assert_eq!(receipt(&value)["verified"], 1);
    assert_eq!(receipt(&value)["unknown"], 0);
    assert_eq!(receipt(&value)["notAttempted"], 1);
    assert_eq!(writes(&owner).len(), 1);
    assert_eq!(
        owner.scheduler.transport.state.borrow().map.0[7],
        Target::Escape.entry()
    );
}

#[test]
fn semantic_target_boundary_matches_documented_strings() {
    for (text, usage) in [
        ("digit1", 30),
        ("digit0", 39),
        ("f12", 69),
        ("escape", 41),
        ("left_gui", 227),
        ("right_control", 228),
    ] {
        let target: Target = serde_json::from_str(&format!("\"{text}\"")).unwrap();
        assert_eq!(target.entry(), Entry([0, 0, usage, 0]));
        assert_eq!(serde_json::to_value(target).unwrap(), text);
    }
    for unsupported in [
        "digit_1",
        "consumer_volume_up",
        "macro",
        "chord",
        "raw",
        "0x29",
    ] {
        assert!(serde_json::from_str::<Target>(&format!("\"{unsupported}\"")).is_err());
    }
}
#[test]
fn empty_operations_also_reject_extra_fields() {
    for operation in [
        "hello",
        "list_candidates",
        "list_snapshots",
        "export_diagnostics",
    ] {
        assert!(
            ipc::parse(
                &serde_json::to_vec(
                    &json!({"v":1,"id":"x","command":{"type":operation,"extra":true}})
                )
                .unwrap()
            )
            .is_err()
        );
    }
}
#[test]
fn disconnected_engine_requires_fresh_owner_and_cannot_reanimate_old_plan() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    call(
        &mut owner,
        json!({"type":"disconnect","sessionId":session}),
        &Cancellation::default(),
    )
    .unwrap();
    let count = owner.scheduler.transport.state.borrow().trace.len();
    assert_eq!(owner.connect().unwrap_err().code, "fresh_owner_required");
    assert!(apply(&mut owner, &session, &plan, &Cancellation::default()).is_err());
    assert_eq!(owner.scheduler.transport.state.borrow().trace.len(), count);
    let (fake, clock, store) = parts(&capability());
    let mut restarted =
        Engine::new(fake, clock, store, capability(), "new-worker-nonce".into()).unwrap();
    let new_session = restarted.connect().unwrap();
    assert_ne!(new_session, session);
    assert!(
        apply(
            &mut restarted,
            &new_session,
            &plan,
            &Cancellation::default()
        )
        .is_err()
    );
}
#[test]
fn complete_restore_uses_same_plan_and_wire_path() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    let applied = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    let snapshot = receipt(&applied)["snapshotId"]
        .as_str()
        .unwrap()
        .to_string();
    let hash = read(&mut owner, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .to_string();
    let prepared=call(&mut owner,json!({"type":"stage_snapshot_restore","sessionId":session,"snapshotId":snapshot,"baselineHash":hash}),&Cancellation::default()).unwrap();
    assert_eq!(prepared["writes"], 1);
    let result = apply(
        &mut owner,
        &session,
        prepared["planId"].as_str().unwrap(),
        &Cancellation::default(),
    )
    .unwrap();
    assert_eq!(receipt(&result)["status"], "verified");
    assert_eq!(
        owner.scheduler.transport.state.borrow().map.0[7],
        Target::CapsLock.entry()
    );
    assert_eq!(writes(&owner).len(), 2);
    assert_eq!(writes(&owner)[1].packet[10], 0x39);
    assert_eq!(owner.store.0.borrow().snapshots.len(), 2);
}
#[test]
fn incompatible_corrupted_and_later_layer_restore_never_writes() {
    for kind in 0..4 {
        let (mut owner, session, hash) = setup();
        let cap = capability();
        let original = owner.scheduler.transport.state.borrow().map.clone();
        let mut layers = BTreeMap::from([(Layer::Base, original.clone())]);
        if kind == 2 {
            let mut later = original.clone();
            later.0[127] = Entry([0xfa, 3, 9, 7]);
            layers.insert(Layer::Fn, later);
        }
        let mut snapshot = Snapshot::new(
            "import-snapshot".into(),
            &cap.identity,
            &cap,
            Profile::observed(if kind == 1 { 3 } else { 4 }).unwrap(),
            100,
            &layers,
        );
        if kind == 0 {
            snapshot.content_hash = "f".repeat(64);
        }
        if kind == 3 {
            snapshot.layers.get_mut(&Layer::Base).unwrap().truncate(100);
        }
        owner
            .store
            .0
            .borrow_mut()
            .snapshots
            .insert(snapshot.snapshot_id.clone(), snapshot);
        let error = call(
            &mut owner,
            json!({"type":"stage_snapshot_restore","sessionId":session,"snapshotId":"import-snapshot","baselineHash":hash}),
            &Cancellation::default(),
        );
        assert!(error.is_err());
        assert!(writes(&owner).is_empty());
    }
}
#[test]
fn capability_validates_exact_profiles_links_unique_slots_and_fixed_bounds() {
    assert!(Slot::new(128).is_err());
    assert!(Profile::observed(16).is_err());
    assert_eq!(Profile::observed(4).unwrap().wire(), 4);
    for kind in 0..5 {
        let mut cap = capability();
        match kind {
            0 => cap.identity.interface.link = Link::Receiver,
            1 => cap.keys[1].slot = cap.keys[0].slot,
            2 => cap.keys[1].id = cap.keys[0].id.clone(),
            3 => {
                cap.profiles = BTreeSet::from([16]);
            }
            _ => {
                cap.write_layers.insert(Layer::Fn);
            }
        }
        let (fake, clock, store) = parts(&cap);
        assert!(Engine::new(fake, clock, store, cap, "test".into()).is_err());
    }
    let mut cap = capability();
    cap.profiles = BTreeSet::from([3]);
    let (fake, clock, store) = parts(&cap);
    let mut owner = Engine::new(fake, clock, store, cap, "test".into()).unwrap();
    assert_eq!(owner.connect().unwrap_err().code, "read_only");
    assert!(writes(&owner).is_empty());
}
static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);
struct PrivateDirectory(PathBuf);
impl PrivateDirectory {
    fn new() -> Self {
        let sequence = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        Self(std::env::temp_dir().join(format!(
            "jazzkeys-core-test-{}-{sequence}",
            std::process::id()
        )))
    }
}
impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn fs_owner(root: PathBuf) -> (Engine<Fake, FakeClock, FsStore>, String, String) {
    let cap = capability();
    let (fake, clock, _) = parts(&cap);
    let store = FsStore::open(root).unwrap();
    let mut owner = Engine::new(fake, clock, store, cap, "disk-owner".into()).unwrap();
    let session = owner.connect().unwrap();
    let hash = read(&mut owner, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .into();
    (owner, session, hash)
}
fn fs_plan(owner: &mut Engine<Fake, FakeClock, FsStore>, session: &str, hash: &str) -> String {
    call(owner,json!({"type":"prepare_changes","sessionId":session,"baselineHash":hash,"layer":"base","changes":[{"physicalKey":"caps-lock","target":"escape"}]}),&Cancellation::default()).unwrap()["planId"].as_str().unwrap().into()
}
#[test]
fn production_filesystem_saves_verified_snapshot_exact_intent_and_full_outcome() {
    let root = PrivateDirectory::new();
    let (mut owner, session, hash) = fs_owner(root.0.clone());
    assert!(FsStore::open(root.0.clone()).is_err());
    let plan = fs_plan(&mut owner, &session, &hash);
    let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    let snapshot_id = receipt(&value)["snapshotId"].as_str().unwrap();
    let snapshot = owner.store.load_snapshot(snapshot_id).unwrap();
    assert_eq!(
        snapshot.maps().unwrap()[&Layer::Base].0[7],
        Target::CapsLock.entry()
    );
    let journal = std::fs::read_to_string(root.0.join(format!("{plan}.journal"))).unwrap();
    let events: Vec<Value> = journal
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        events[0]["intent"]["changes"][0]["before"],
        json!([0, 0, 57, 0])
    );
    assert_eq!(
        events[0]["intent"]["changes"][0]["after"],
        json!([0, 0, 41, 0])
    );
    assert_eq!(events[0]["intent"]["changes"][0]["slot"], 7);
    let finished = events.last().unwrap();
    assert_eq!(finished["preserved"], true);
    assert_eq!(finished["verified_keys"], json!(["caps-lock"]));
    assert_eq!(finished["unknown_keys"], json!([]));
    assert!(!FsStore::inspect(&root.0).unwrap()[0].uncertain);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&root.0).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(root.0.join(format!("{snapshot_id}.snapshot")))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn restart_inspection_keeps_preservation_failure_unresolved_without_device_traffic() {
    let root = PrivateDirectory::new();
    let (mut owner, session, hash) = fs_owner(root.0.clone());
    let plan = fs_plan(&mut owner, &session, &hash);
    owner
        .scheduler
        .transport
        .state
        .borrow_mut()
        .corrupt_neighbor = true;
    let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    assert_eq!(receipt(&value)["status"], "partial");
    let count = owner.scheduler.transport.state.borrow().trace.len();
    let recovered = FsStore::inspect(&root.0).unwrap();
    assert!(recovered[0].uncertain);
    assert_eq!(owner.scheduler.transport.state.borrow().trace.len(), count);
    let raw = std::fs::read_to_string(root.0.join(format!("{plan}.journal"))).unwrap();
    assert!(raw.contains("preservation_mismatch"));
}
struct CrashAfterSend(FsStore);
impl Store for CrashAfterSend {
    fn save_before(&mut self, snapshot: &Snapshot, intent: &JournalIntent) -> Result<()> {
        self.0.save_before(snapshot, intent)
    }
    fn append(&mut self, plan: &str, event: &JournalEvent) -> Result<()> {
        if matches!(event, JournalEvent::Sent { .. }) {
            panic!("Simulated process crash after send, before durable acknowledgement");
        }
        self.0.append(plan, event)
    }
    fn load_snapshot(&self, id: &str) -> Result<Snapshot> {
        self.0.load_snapshot(id)
    }
}
#[test]
fn crash_after_send_retains_durable_intent_and_startup_never_replays() {
    let root = PrivateDirectory::new();
    let cap = capability();
    let (fake, clock, _) = parts(&cap);
    let shared = fake.state.clone();
    let mut owner = Engine::new(
        fake,
        clock,
        CrashAfterSend(FsStore::open(root.0.clone()).unwrap()),
        cap,
        "crash-owner".into(),
    )
    .unwrap();
    let session = owner.connect().unwrap();
    let hash = read(&mut owner, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .to_string();
    let plan=call(&mut owner,json!({"type":"prepare_changes","sessionId":session,"baselineHash":hash,"layer":"base","changes":[{"physicalKey":"caps-lock","target":"escape"}]}),&Cancellation::default()).unwrap()["planId"].as_str().unwrap().to_string();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        apply(&mut owner, &session, &plan, &Cancellation::default())
    }));
    assert!(result.is_err());
    drop(owner);
    let count = shared.borrow().trace.len();
    let recovery = FsStore::inspect(&root.0).unwrap();
    assert!(recovery[0].uncertain);
    assert!(recovery[0].snapshot_id.is_some());
    assert_eq!(shared.borrow().map.0[7], Target::Escape.entry());
    assert_eq!(shared.borrow().trace.len(), count);
    let reopened = FsStore::open(root.0.clone()).unwrap();
    assert_eq!(shared.borrow().trace.len(), count);
    drop(reopened);
}
#[test]
fn torn_journal_tail_and_corrupt_snapshot_are_not_silently_accepted() {
    use std::io::Write;
    let root = PrivateDirectory::new();
    let (mut owner, session, hash) = fs_owner(root.0.clone());
    let plan = fs_plan(&mut owner, &session, &hash);
    let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    let snapshot = receipt(&value)["snapshotId"].as_str().unwrap();
    let mut journal = std::fs::OpenOptions::new()
        .append(true)
        .open(root.0.join(format!("{plan}.journal")))
        .unwrap();
    journal.write_all(b"{\"event\":\"send").unwrap();
    journal.sync_all().unwrap();
    let recovery = FsStore::inspect(&root.0).unwrap();
    assert!(recovery[0].uncertain);
    assert!(recovery[0].torn_tail);
    std::fs::write(root.0.join(format!("{snapshot}.snapshot")), b"{}").unwrap();
    assert!(owner.store.load_snapshot(snapshot).is_err());
}
#[test]
#[cfg(unix)]
fn production_store_refuses_world_accessible_directory_and_symlink_files() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let root = PrivateDirectory::new();
    std::fs::create_dir(&root.0).unwrap();
    std::fs::set_permissions(&root.0, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(FsStore::open(root.0.clone()).is_err());
    std::fs::set_permissions(&root.0, std::fs::Permissions::from_mode(0o700)).unwrap();
    let store = FsStore::open(root.0.clone()).unwrap();
    symlink("outside-file", root.0.join("attacker.snapshot")).unwrap();
    assert!(store.load_snapshot("attacker").is_err());
    assert!(store.load_snapshot("../escape").is_err());
}

#[test]
fn forty_key_plan_expires_before_start_not_mid_operation() {
    let mut cap = capability();
    cap.keys = (0..40)
        .map(|slot| PhysicalKey {
            id: format!("key-{slot}"),
            slot: Slot::new(slot).unwrap(),
            protected: false,
        })
        .collect();
    let (fake, clock, store) = parts(&cap);
    fake.state.borrow_mut().map = Keymap([Target::A.entry(); 128]);
    let mut owner = Engine::new(fake, clock, store, cap, "large-plan".into()).unwrap();
    let session = owner.connect().unwrap();
    let baseline = read(&mut owner, &session)["baselineHash"]
        .as_str()
        .unwrap()
        .to_string();
    let changes: Vec<Value> = (0..40)
        .map(|slot| json!({"physicalKey":format!("key-{slot}"),"target":"z"}))
        .collect();
    let prepared = prepare(&mut owner, &session, &baseline, json!(changes));
    let start = owner.scheduler.clock.0.get();
    let value = apply(
        &mut owner,
        &session,
        prepared["planId"].as_str().unwrap(),
        &Cancellation::default(),
    )
    .unwrap();
    assert_eq!(receipt(&value)["status"], "verified");
    assert_eq!(receipt(&value)["verified"], 40);
    assert_eq!(writes(&owner).len(), 40);
    assert!(owner.scheduler.clock.0.get() - start > 30_000);
}
#[test]
fn startup_rejects_orphan_duplicate_invalid_transitions_and_inconsistent_outcomes() {
    for kind in 0..5 {
        let root = PrivateDirectory::new();
        let (mut owner, session, hash) = fs_owner(root.0.clone());
        let plan = fs_plan(&mut owner, &session, &hash);
        apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
        let path = root.0.join(format!("{plan}.journal"));
        let text = std::fs::read_to_string(&path).unwrap();
        let mut events: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        match kind {
            0 => events = vec![events.last().unwrap().clone()],
            1 => events.insert(1, events[0].clone()),
            2 => {
                events.last_mut().unwrap()["verified_keys"] = json!(["other-key"]);
            }
            3 => {
                events.last_mut().unwrap()["not_attempted"] = json!(1);
            }
            _ => events.swap(1, 2),
        }
        let replacement = events
            .into_iter()
            .map(|v| format!("{v}\n"))
            .collect::<String>();
        std::fs::write(&path, replacement).unwrap();
        let before = owner.scheduler.transport.state.borrow().trace.len();
        assert!(FsStore::inspect(&root.0).is_err());
        assert_eq!(owner.scheduler.transport.state.borrow().trace.len(), before);
    }
}
#[test]
fn journal_failure_after_send_retains_uncertainty_without_readback_or_retry() {
    let (mut owner, session, hash) = setup();
    let prepared = prepare(
        &mut owner,
        &session,
        &hash,
        json!([{"physicalKey":"caps-lock","target":"escape"},{"physicalKey":"key-a","target":"z"}]),
    );
    owner.store.0.borrow_mut().fail_append = Some(2);
    let value = apply(
        &mut owner,
        &session,
        prepared["planId"].as_str().unwrap(),
        &Cancellation::default(),
    )
    .unwrap();
    assert_eq!(receipt(&value)["status"], "uncertain");
    assert_eq!(receipt(&value)["unknown_keys"], Value::Null);
    assert_eq!(receipt(&value)["unknownKeys"], json!(["caps-lock"]));
    assert_eq!(
        owner
            .scheduler
            .transport
            .state
            .borrow()
            .trace
            .last()
            .unwrap()
            .packet[0],
        0x13
    );
    assert_eq!(writes(&owner).len(), 1);
}

#[test]
fn final_journal_failure_keeps_observed_readback_facts() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    owner.store.0.borrow_mut().fail_append = Some(3);
    let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
    assert_eq!(receipt(&value)["status"], "uncertain");
    assert_eq!(receipt(&value)["reason"], "journal_finish_failed");
    assert_eq!(receipt(&value)["verified"], 1);
    assert_eq!(receipt(&value)["unknown"], 0);
    assert_eq!(receipt(&value)["preserved"], true);
    assert_eq!(receipt(&value)["readbackComplete"], true);
    assert_eq!(writes(&owner).len(), 1);
}

#[test]
fn snapshot_duplicate_layer_cannot_hide_an_invalid_earlier_record() {
    let cap = capability();
    let (fake, _, _) = parts(&cap);
    let snapshot = Snapshot::new(
        "snapshot".into(),
        &cap.identity,
        &cap,
        Profile::observed(4).unwrap(),
        0,
        &BTreeMap::from([(Layer::Base, fake.state.borrow().map.clone())]),
    );
    let raw = serde_json::to_string(&snapshot).unwrap();
    let duplicate = raw.replace("\"layers\":{", "\"layers\":{\"base\":\"malformed\",");
    assert!(Snapshot::parse(duplicate.as_bytes()).is_err());
}

#[test]
fn third_value_on_target_is_partial_with_actual_evidence_not_rejected() {
    for corrupt in [Target::Z.entry(), Entry([0xfa, 1, 2, 3])] {
        let root = PrivateDirectory::new();
        let (mut owner, session, hash) = fs_owner(root.0.clone());
        let plan = fs_plan(&mut owner, &session, &hash);
        owner.scheduler.transport.state.borrow_mut().corrupt_target = Some(corrupt);
        let value = apply(&mut owner, &session, &plan, &Cancellation::default()).unwrap();
        let result = receipt(&value);
        assert_eq!(result["status"], "partial");
        assert_eq!(result["reason"], "mapping_mismatch");
        assert_eq!(result["unknown"], 0);
        assert_eq!(result["verified"], 0);
        assert_eq!(result["preserved"], true);
        assert_eq!(result["mismatches"][0]["physicalKey"], "caps-lock");
        assert_eq!(result["mismatches"][0]["changedFromOriginal"], true);
        assert_eq!(
            result["mismatches"][0]["actual"],
            serde_json::to_value(Target::from_entry(corrupt)).unwrap()
        );
        assert_eq!(
            result["mismatches"][0]["actualUnsupported"],
            Target::from_entry(corrupt).is_none()
        );
        assert!(result.get("observed").is_none());
        let path = root.0.join(format!("{plan}.journal"));
        let raw = std::fs::read_to_string(&path).unwrap();
        let mut events: Vec<Value> = raw
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let observed =
            Keymap::from_hex(events.last().unwrap()["readback_hex"].as_str().unwrap()).unwrap();
        assert_eq!(observed.0[7], corrupt);
        assert!(FsStore::inspect(&root.0).unwrap()[0].uncertain);
        events.last_mut().unwrap()["status"] = json!("rejected");
        std::fs::write(
            path,
            events
                .into_iter()
                .map(|event| format!("{event}\n"))
                .collect::<String>(),
        )
        .unwrap();
        assert!(FsStore::inspect(&root.0).is_err());
    }
}

#[test]
fn metadata_failures_poison_owner_even_when_interface_later_recovers() {
    for fault in [
        TransportError::Disconnected,
        TransportError::Timeout,
        TransportError::Stall,
        TransportError::Protocol,
        TransportError::ReadOnly,
    ] {
        let (mut owner, session, hash) = setup();
        let plan = one_plan(&mut owner, &session, &hash);
        let before = owner.scheduler.transport.state.borrow().trace.len();
        owner.scheduler.transport.state.borrow_mut().interface_error = Some(fault);
        let error = call(
            &mut owner,
            json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
            &Cancellation::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, fault.fault().code);
        owner.scheduler.transport.state.borrow_mut().interface_error = None;
        assert!(apply(&mut owner, &session, &plan, &Cancellation::default()).is_err());
        assert!(
            call(
                &mut owner,
                json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
                &Cancellation::default()
            )
            .is_err()
        );
        assert_eq!(owner.scheduler.transport.state.borrow().trace.len(), before);
        assert!(writes(&owner).is_empty());
    }
}

#[test]
fn out_of_bounds_observed_profile_poison_survives_a_later_valid_response() {
    let (mut owner, session, hash) = setup();
    let plan = one_plan(&mut owner, &session, &hash);
    owner.scheduler.transport.state.borrow_mut().profile = 16;
    let error = call(
        &mut owner,
        json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
        &Cancellation::default(),
    )
    .unwrap_err();
    assert_eq!(error.code, "read_only");
    let after_fault = owner.scheduler.transport.state.borrow().trace.len();
    owner.scheduler.transport.state.borrow_mut().profile = 4;
    assert!(apply(&mut owner, &session, &plan, &Cancellation::default()).is_err());
    assert!(
        call(
            &mut owner,
            json!({"type":"read_current_keymap","sessionId":session,"layer":"base"}),
            &Cancellation::default()
        )
        .is_err()
    );
    assert_eq!(
        owner.scheduler.transport.state.borrow().trace.len(),
        after_fault
    );
    assert!(writes(&owner).is_empty());
}
