# Worker protocol v1

The packaged worker is `jazzkeys-device` version `0.1.0`. It accepts no CLI arguments. Launch the reviewed app-relative binary directly, with private piped stdin/stdout. It has **no HID backend**, no writable production capability, and no fake-device CLI mode. The app owns its visual demo simulation; it cannot mistake worker demo state for real hardware.

One UTF-8 JSON object per newline, maximum **65,536 bytes excluding newline**; EOF may terminate one bounded final frame. Oversized frames close the pipe after one error. Unknown fields at every schema level, unknown enum variants, duplicate fields, invalid IDs, version mismatches and malformed JSON fail closed. IDs are 1–64 ASCII alphanumeric / `_` / `-`; duplicate request IDs receive `duplicate_request` (the bounded receipt window is 256 requests). Each connection supports at most 4,096 requests before requiring a new worker. Requests are handled serially. Stdout is protocol only; stderr has bounded non-keymap diagnostics.

Request: `{"v":1,"id":"hello-1","command":{"type":"hello"}}`

Success: `{"v":1,"id":"hello-1","ok":true,"result":{"type":"hello","workerVersion":"0.1.0","protocolVersion":1,"mode":"no_hardware","hardwareAccess":false,"maxFrameBytes":65536}}`

Failure: `{"v":1,"id":"request-1","ok":false,"error":{"code":"hardware_unavailable","message":"This build has no hardware backend"}}`

For unparseable frames, `id` is null. Request IDs are never recovered by a permissive partial parser. Clients must validate version, matching ID, `ok`, result type, and hello's exact worker version / no-hardware status. Client timeout is not a write receipt. No auto-replay after a worker failure.

## Commands

- `hello`: metadata above
- `list_candidates`: returns `{type:"candidates",candidates:[],hardwareAccess:false}`; does not open HID
- `connect_candidate` with `candidateId`: unavailable in this build
- `read_current_keymap` with `sessionId`, `layer` (`base` or `fn`)
- `prepare_changes` with `sessionId`, `baselineHash`, `layer`, `changes:[{physicalKey,target}]`
- `apply_prepared_plan` with `sessionId`, `planId`
- `cancel_pending_apply` with `sessionId`, `planId`
- `list_snapshots`: returns `{type:"snapshots",snapshots:[]}` in the no-hardware worker
- `stage_snapshot_restore` with `sessionId`, `snapshotId`, `baselineHash`
- `disconnect` with `sessionId`: returns `{type:"disconnected"}` even if no session is active
- `export_diagnostics`: returns `{type:"diagnostics",workerVersion:"0.1.0",mode:"no_hardware",hardwareAccess:false}` without identifiers, keymap, paths or ordinary typing

Hardware-dependent commands return `hardware_unavailable`; `cancel_pending_apply` returns `no_active_plan`. At most 128 changes are accepted; targets are semantic strings. Core library tests exercise the same parsed request commands through a private fake owner. No public API can manufacture verified write capability.

Supported targets: letters `a`–`z`; words `digit1`–`digit0`; `enter`, `escape`, `backspace`, `tab`, `space`, `minus`, `equal`, `left_bracket`, `right_bracket`, `backslash`, `semicolon`, `quote`, `grave`, `comma`, `period`, `slash`, `caps_lock`; `f1`–`f12`; `print_screen`, `scroll_lock`, `pause`, `insert`, `home`, `page_up`, `delete`, `end`, `page_down`, `right`, `left`, `down`, `up`; modifiers `left_control`, `left_shift`, `left_alt`, `left_gui`, `right_control`, `right_shift`, `right_alt`, `right_gui`.

No profile numbers, slot addresses, opcodes, arbitrary raw byte arrays, imported filesystem paths, worker executable paths, bulk/reset/firmware or raw-command operation is accepted.

## Current limits

The no-hardware worker is synchronous because every exposed operation is bounded and performs no device I/O. A future real transport must add the private-pipe cancellation reader/watchdog before exposure; the tested engine already accepts an atomic cancellation token checked at safe boundaries. A hung native HID call cannot be made safe by killing a process: the supervisor must report an uncertain outcome, preserve the journal and never replay. No release claim includes actual device validation, IPC-driven concurrent cancellation, OS HID exclusivity, or a production transport deadline.

The private core Engine has one connection lifetime. Once disconnected or invalidated, it cannot reconnect. A future real owner must create a fresh transport/scheduler with a new unpredictable per-worker nonce and deliberate stable read; old plans cannot be transferred.
