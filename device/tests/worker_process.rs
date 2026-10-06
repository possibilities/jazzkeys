//! Exercise the executable boundary, not a fake receipt or source-code assertion.
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn compiled_worker_handshakes_with_empty_environment_and_final_eof_frame() {
    let mut worker = Command::new(env!("CARGO_BIN_EXE_jazzkeys-device"))
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let request = json!({"v":1,"id":"packaging-hello","command":{"type":"hello"}}).to_string();
    worker
        .stdin
        .take()
        .unwrap()
        .write_all(request.as_bytes())
        .unwrap();
    let result = worker.wait_with_output().unwrap();
    assert!(result.status.success());
    assert!(result.stderr.is_empty());
    let message: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(
        message,
        json!({"v":1,"id":"packaging-hello","ok":true,"result":{"type":"hello","workerVersion":"0.1.0","protocolVersion":1,"mode":"no_hardware","hardwareAccess":false,"maxFrameBytes":65536}})
    );
}

#[test]
fn compiled_worker_rejects_fake_and_raw_cli_switches() {
    for switch in ["--unsafe", "--fake-verified", "--opcode", "--device"] {
        let result = Command::new(env!("CARGO_BIN_EXE_jazzkeys-device"))
            .arg(switch)
            .env_clear()
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert!(result.stderr.len() < 256);
    }
}
