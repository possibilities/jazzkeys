use crate::domain::*;
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, VecDeque},
    io::{self, BufRead, Write},
};

pub(crate) fn parse(frame: &[u8]) -> Result<Request> {
    if frame.len() > MAX_FRAME {
        return Err(Fault::new(
            "frame_too_large",
            "IPC frame exceeds 65536 bytes",
        ));
    }
    let request: Request = serde_json::from_slice(frame).map_err(|_| INVALID)?;
    if request.v != PROTOCOL_VERSION {
        return Err(Fault::new(
            "unsupported_version",
            "Worker requires protocol version 1",
        ));
    }
    if !valid_id(&request.id) {
        return Err(INVALID);
    }
    let hash = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    match &request.command {
        Command::ConnectCandidate { candidate_id } if !valid_id(candidate_id) => {
            return Err(INVALID);
        }
        Command::ReadCurrentKeymap { session_id, .. } | Command::Disconnect { session_id }
            if !valid_id(session_id) =>
        {
            return Err(INVALID);
        }
        Command::PrepareChanges {
            session_id,
            baseline_hash,
            changes,
            ..
        } if !valid_id(session_id)
            || !hash(baseline_hash)
            || changes.len() > SLOTS
            || changes.iter().any(|change| !valid_id(&change.physical_key)) =>
        {
            return Err(INVALID);
        }
        Command::ApplyPreparedPlan {
            session_id,
            plan_id,
        }
        | Command::CancelPendingApply {
            session_id,
            plan_id,
        } if !valid_id(session_id) || !valid_id(plan_id) => return Err(INVALID),
        Command::StageSnapshotRestore {
            session_id,
            snapshot_id,
            baseline_hash,
        } if !valid_id(session_id) || !valid_id(snapshot_id) || !hash(baseline_hash) => {
            return Err(INVALID);
        }
        _ => {}
    }
    Ok(request)
}
fn no_hardware(command: Command) -> Result<Value> {
    match command {
        Command::Hello {} => Ok(
            json!({"type":"hello","workerVersion":env!("CARGO_PKG_VERSION"),"protocolVersion":PROTOCOL_VERSION,"mode":"no_hardware","hardwareAccess":false,"maxFrameBytes":MAX_FRAME}),
        ),
        Command::ListCandidates {} => {
            Ok(json!({"type":"candidates","candidates":[],"hardwareAccess":false}))
        }
        Command::ListSnapshots {} => Ok(json!({"type":"snapshots","snapshots":[]})),
        Command::ExportDiagnostics {} => Ok(
            json!({"type":"diagnostics","workerVersion":env!("CARGO_PKG_VERSION"),"mode":"no_hardware","hardwareAccess":false}),
        ),
        Command::Disconnect { .. } => Ok(json!({"type":"disconnected"})),
        Command::CancelPendingApply { .. } => {
            Err(Fault::new("no_active_plan", "No hardware plan is active"))
        }
        _ => Err(Fault::new(
            "hardware_unavailable",
            "This build has no hardware backend",
        )),
    }
}
fn response(id: Option<&str>, result: Result<Value>) -> Value {
    match result {
        Ok(value) => json!({"v":PROTOCOL_VERSION,"id":id,"ok":true,"result":value}),
        Err(error) => {
            json!({"v":PROTOCOL_VERSION,"id":id,"ok":false,"error":{"code":error.code,"message":error.message}})
        }
    }
}
fn write_response(output: &mut impl Write, response: Value) -> io::Result<()> {
    serde_json::to_writer(&mut *output, &response)?;
    output.write_all(b"\n")?;
    output.flush()
}
enum Frame {
    Data(Vec<u8>),
    End,
    Oversized,
}
fn read_frame(input: &mut impl BufRead) -> io::Result<Frame> {
    let mut data = Vec::with_capacity(512);
    loop {
        let available = input.fill_buf()?;
        if available.is_empty() {
            return Ok(if data.is_empty() {
                Frame::End
            } else {
                Frame::Data(data)
            });
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let length = newline.unwrap_or(available.len());
        if data.len().saturating_add(length) > MAX_FRAME {
            return Ok(Frame::Oversized);
        }
        data.extend_from_slice(&available[..length]);
        input.consume(length + usize::from(newline.is_some()));
        if newline.is_some() {
            return Ok(Frame::Data(data));
        }
    }
}
/// Runs the production no-hardware worker. There is no global state, device open,
/// filesystem import, automatic connection, raw transport or simulator fallback.
pub fn run(mut input: impl BufRead, mut output: impl Write) -> io::Result<()> {
    let mut ids = BTreeSet::new();
    let mut order = VecDeque::new();
    for _ in 0..4096 {
        let frame = match read_frame(&mut input)? {
            Frame::End => return Ok(()),
            Frame::Oversized => {
                write_response(
                    &mut output,
                    response(
                        None,
                        Err(Fault::new(
                            "frame_too_large",
                            "IPC frame exceeds 65536 bytes; pipe is closing",
                        )),
                    ),
                )?;
                return Ok(());
            }
            Frame::Data(frame) => frame,
        };
        let request = match parse(&frame) {
            Ok(request) => request,
            Err(error) => {
                write_response(&mut output, response(None, Err(error)))?;
                continue;
            }
        };
        let result = if !ids.insert(request.id.clone()) {
            Err(Fault::new(
                "duplicate_request",
                "Request ID was already used; operation was not repeated",
            ))
        } else {
            order.push_back(request.id.clone());
            if order.len() > 256
                && let Some(id) = order.pop_front()
            {
                ids.remove(&id);
            }
            no_hardware(request.command)
        };
        write_response(&mut output, response(Some(&request.id), result))?;
    }
    write_response(
        &mut output,
        response(
            None,
            Err(Fault::new(
                "request_limit",
                "Worker request limit reached; open a new private pipe",
            )),
        ),
    )
}
