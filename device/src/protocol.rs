//! Independently authored narrow encoding from the documented yc500 subset.
//! Reference: Sharkfin 4860eafbcb543d93ce09285204b91f6d853f54b1 docs/PROTOCOL.md.
//! Constants are candidate evidence, NOT authorization for a real unit.
use crate::domain::{Entry, Fault, Interface, Layer, Profile, Result, STALE, Slot};

#[derive(Debug, Clone, Copy)]
pub(crate) enum Operation {
    Identify,
    Revision,
    CurrentProfile,
    ReadPage {
        layer: Layer,
        profile: Profile,
        page: u8,
    },
    WriteSlot {
        layer: Layer,
        profile: Profile,
        slot: Slot,
        entry: Entry,
    },
}
impl Operation {
    pub(crate) fn is_write(self) -> bool {
        matches!(self, Self::WriteSlot { .. })
    }
    pub(crate) fn packet(self) -> Result<[u8; 64]> {
        let mut packet = [0; 64];
        match self {
            Self::Identify => packet[0] = 0x8f,
            Self::Revision => packet[0] = 0x80,
            Self::CurrentProfile => packet[0] = 0x85,
            Self::ReadPage {
                layer,
                profile,
                page,
            } => {
                if page >= 8 {
                    return Err(Fault::new(
                        "invalid_page",
                        "Page is outside the fixed layer",
                    ));
                }
                packet[0] = match layer {
                    Layer::Base => 0x89,
                    Layer::Fn => 0x90,
                };
                packet[1] = profile.wire();
                packet[2] = page;
            }
            Self::WriteSlot {
                layer,
                profile,
                slot,
                entry,
            } => {
                packet[0] = match layer {
                    Layer::Base => 0x13,
                    Layer::Fn => 0x15,
                };
                packet[1] = profile.wire();
                packet[2] = slot.wire();
                packet[8..12].copy_from_slice(&entry.0);
            }
        }
        packet[7] = 0xff_u8.wrapping_sub(
            packet[..7]
                .iter()
                .fold(0_u8, |sum, byte| sum.wrapping_add(*byte)),
        );
        Ok(packet)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Framing {
    Payload,
    ReportIdPrefix,
}
#[derive(Debug, Clone)]
pub(crate) struct WireReply {
    pub bytes: Vec<u8>,
    pub framing: Framing,
}
impl WireReply {
    pub(crate) fn exact_payload(self) -> Result<[u8; 64]> {
        let payload = match self.framing {
            Framing::Payload if self.bytes.len() == 64 => self.bytes.as_slice(),
            Framing::ReportIdPrefix if self.bytes.len() == 65 && self.bytes[0] == 0 => {
                &self.bytes[1..]
            }
            _ => {
                return Err(Fault::new(
                    "invalid_reply_length",
                    "Feature reply framing or length is not exact",
                ));
            }
        };
        let mut result = [0; 64];
        result.copy_from_slice(payload);
        Ok(result)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransportError {
    Timeout,
    Stall,
    Disconnected,
    Protocol,
}
impl TransportError {
    pub(crate) fn fault(self) -> Fault {
        match self {
            Self::Timeout => Fault::new(
                "transport_timeout",
                "Transport deadline expired; no retry sent",
            ),
            Self::Stall => Fault::new("transport_stall", "Transport stalled; no retry sent"),
            Self::Disconnected => Fault::new("device_lost", "Selected interface disconnected"),
            Self::Protocol => Fault::new(
                "transport_protocol",
                "Transport reported an invalid exchange",
            ),
        }
    }
}
// Raw bytes are private to this crate boundary. No production implementation opens HID.
pub(crate) trait Transport {
    fn interface(&self) -> std::result::Result<Interface, TransportError>;
    fn exchange(
        &mut self,
        packet: &[u8; 64],
        expects_reply: bool,
    ) -> std::result::Result<Option<WireReply>, TransportError>;
}
pub(crate) trait Clock {
    fn now_ms(&self) -> u64;
    fn sleep_until(&mut self, deadline_ms: u64);
}
pub(crate) struct MonotonicClock {
    start: std::time::Instant,
}
impl MonotonicClock {
    pub(crate) fn new() -> Self {
        Self {
            start: std::time::Instant::now(),
        }
    }
}
impl Clock for MonotonicClock {
    fn now_ms(&self) -> u64 {
        self.start
            .elapsed()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
    fn sleep_until(&mut self, deadline_ms: u64) {
        let delay = deadline_ms.saturating_sub(self.now_ms());
        if delay > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay));
        }
    }
}

pub(crate) struct Scheduler<T, C> {
    pub transport: T,
    pub clock: C,
    expected: Interface,
    next_wire_ms: u64,
    last_write_completed: Option<u64>,
    invalidated: bool,
}
impl<T: Transport, C: Clock> Scheduler<T, C> {
    pub(crate) fn new(transport: T, clock: C, expected: Interface) -> Self {
        Self {
            transport,
            clock,
            expected,
            next_wire_ms: 0,
            last_write_completed: None,
            invalidated: false,
        }
    }
    pub(crate) fn invalidate(&mut self) {
        self.invalidated = true;
    }
    pub(crate) fn now(&self) -> u64 {
        self.clock.now_ms()
    }
    pub(crate) fn wait_ready(&mut self) -> Result<()> {
        if self.invalidated {
            return Err(STALE);
        }
        self.clock.sleep_until(self.next_wire_ms);
        if self.transport.interface().map_err(TransportError::fault)? != self.expected {
            self.invalidated = true;
            return Err(STALE);
        }
        Ok(())
    }
    pub(crate) fn execute(&mut self, operation: Operation) -> Result<Option<[u8; 64]>> {
        self.wait_ready()?;
        let packet = operation.packet()?;
        let response = self.transport.exchange(&packet, !operation.is_write());
        // Deadlines derive from actual completion, including failed and slow calls.
        let completed = self.clock.now_ms();
        self.next_wire_ms = completed.saturating_add(if operation.is_write() { 1000 } else { 8 });
        if operation.is_write() {
            self.last_write_completed = Some(completed);
        }
        let result = match response {
            Err(error) => Err(error.fault()),
            Ok(None) if operation.is_write() => Ok(None),
            Ok(Some(reply)) if !operation.is_write() => reply.exact_payload().map(Some),
            _ => Err(Fault::new(
                "unexpected_reply",
                "Transport reply does not match the operation",
            )),
        };
        if result.is_err() {
            self.invalidated = true;
        }
        result
    }
    pub(crate) fn read(&mut self, operation: Operation) -> Result<[u8; 64]> {
        self.execute(operation)?.ok_or(Fault::new(
            "missing_reply",
            "Read operation produced no reply",
        ))
    }
    pub(crate) fn settle(&mut self) {
        if let Some(last) = self.last_write_completed {
            self.clock.sleep_until(last.saturating_add(2000));
        }
    }
}
