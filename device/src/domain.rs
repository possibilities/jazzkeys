use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const MAX_FRAME: usize = 65_536;
pub(crate) const PROTOCOL_VERSION: u8 = 1;
pub(crate) const LAYER_BYTES: usize = 512;
pub(crate) const SLOTS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Layer {
    Base,
    Fn,
}

macro_rules! targets {
    ($($name:ident = $value:expr),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub(crate) enum Target { $($name),+ }
        impl Target {
            pub(crate) fn entry(self) -> Entry { Entry([0, 0, match self { $(Self::$name => $value),+ }, 0]) }
            pub(crate) fn from_entry(entry: Entry) -> Option<Self> {
                if entry.0[0] != 0 || entry.0[1] != 0 || entry.0[3] != 0 { return None; }
                match entry.0[2] { $($value => Some(Self::$name)),+, _ => None }
            }
        }
    }
}
targets! {
    A=4,B=5,C=6,D=7,E=8,F=9,G=10,H=11,I=12,J=13,K=14,L=15,M=16,N=17,O=18,P=19,Q=20,R=21,S=22,T=23,U=24,V=25,W=26,X=27,Y=28,Z=29,
    Digit1=30,Digit2=31,Digit3=32,Digit4=33,Digit5=34,Digit6=35,Digit7=36,Digit8=37,Digit9=38,Digit0=39,
    Enter=40,Escape=41,Backspace=42,Tab=43,Space=44,Minus=45,Equal=46,LeftBracket=47,RightBracket=48,Backslash=49,
    Semicolon=51,Quote=52,Grave=53,Comma=54,Period=55,Slash=56,CapsLock=57,
    F1=58,F2=59,F3=60,F4=61,F5=62,F6=63,F7=64,F8=65,F9=66,F10=67,F11=68,F12=69,
    PrintScreen=70,ScrollLock=71,Pause=72,Insert=73,Home=74,PageUp=75,Delete=76,End=77,PageDown=78,Right=79,Left=80,Down=81,Up=82,
    LeftControl=224,LeftShift=225,LeftAlt=226,LeftGui=227,RightControl=228,RightShift=229,RightAlt=230,RightGui=231
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    pub v: u8,
    pub id: String,
    pub command: Command,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Command {
    Hello {},
    ListCandidates {},
    ConnectCandidate {
        #[serde(rename = "candidateId")]
        candidate_id: String,
    },
    ReadCurrentKeymap {
        #[serde(rename = "sessionId")]
        session_id: String,
        layer: Layer,
    },
    PrepareChanges {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "baselineHash")]
        baseline_hash: String,
        layer: Layer,
        changes: Vec<Edit>,
    },
    ApplyPreparedPlan {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "planId")]
        plan_id: String,
    },
    CancelPendingApply {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "planId")]
        plan_id: String,
    },
    ListSnapshots {},
    StageSnapshotRestore {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "snapshotId")]
        snapshot_id: String,
        #[serde(rename = "baselineHash")]
        baseline_hash: String,
    },
    Disconnect {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    ExportDiagnostics {},
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Edit {
    pub physical_key: String,
    pub target: Target,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Fault {
    pub code: &'static str,
    pub message: &'static str,
}
impl Fault {
    pub(crate) const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}
pub(crate) type Result<T> = std::result::Result<T, Fault>;
pub(crate) const INVALID: Fault = Fault::new(
    "invalid_request",
    "Request failed bounded schema validation",
);
pub(crate) const STALE: Fault = Fault::new(
    "stale_session",
    "Session identity, profile, generation or plan changed",
);
pub(crate) const READ_ONLY: Fault =
    Fault::new("read_only", "No verified capability permits this operation");
pub(crate) const STORAGE: Fault = Fault::new(
    "storage_failed",
    "Durable snapshot or journal could not be verified",
);

pub(crate) fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub(crate) fn digest(bytes: &[u8]) -> String {
    let value = Sha256::digest(bytes);
    value.iter().map(|b| format!("{b:02x}")).collect()
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Entry(pub [u8; 4]);
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Keymap(pub [Entry; SLOTS]);
impl Keymap {
    pub(crate) fn bytes(&self) -> Vec<u8> {
        self.0.iter().flat_map(|e| e.0).collect()
    }
    pub(crate) fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != LAYER_BYTES {
            return Err(INVALID);
        }
        let mut entries = [Entry([0; 4]); SLOTS];
        for (slot, chunk) in entries.iter_mut().zip(bytes.chunks_exact(4)) {
            slot.0.copy_from_slice(chunk);
        }
        Ok(Self(entries))
    }
    pub(crate) fn hash(&self) -> String {
        digest(&self.bytes())
    }
    pub(crate) fn hex(&self) -> String {
        self.bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
    pub(crate) fn from_hex(hex: &str) -> Result<Self> {
        if hex.len() != 1024 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(INVALID);
        }
        let bytes: Result<Vec<u8>> = hex
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                u8::from_str_radix(std::str::from_utf8(pair).map_err(|_| INVALID)?, 16)
                    .map_err(|_| INVALID)
            })
            .collect();
        Self::from_bytes(&bytes?)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Slot(u8);
impl Slot {
    pub(crate) fn new(slot: usize) -> Result<Self> {
        if slot < SLOTS {
            Ok(Self(slot as u8))
        } else {
            Err(INVALID)
        }
    }
    pub(crate) fn index(self) -> usize {
        usize::from(self.0)
    }
    pub(crate) fn wire(self) -> u8 {
        self.0
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Profile(u8);
impl Profile {
    // A bound on a response field is not a guessed profile count. The capability must separately evidence this exact index.
    pub(crate) fn observed(index: u8) -> Result<Self> {
        if index <= 15 {
            Ok(Self(index))
        } else {
            Err(READ_ONLY)
        }
    }
    pub(crate) fn wire(self) -> u8 {
        self.0
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Link {
    DirectUsb,
    Receiver,
    Bluetooth,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Interface {
    pub instance: String,
    pub vid: u16,
    pub pid: u16,
    pub usage_page: u16,
    pub usage: u16,
    pub descriptor_hash: String,
    pub report_id: u8,
    pub payload_bytes: u16,
    pub link: Link,
    pub mode: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Identity {
    pub interface: Interface,
    pub internal_id: u32,
    pub revision: u32,
}
impl Identity {
    pub(crate) fn binding_hash(&self) -> String {
        digest(&serde_json::to_vec(self).expect("identity is infallibly serializable"))
    }
}
#[derive(Debug, Clone)]
pub(crate) struct PhysicalKey {
    pub id: String,
    pub slot: Slot,
    pub protected: bool,
}
#[derive(Debug, Clone)]
pub(crate) struct Capability {
    pub record_id: String,
    pub layout_id: String,
    pub identity: Identity,
    pub profiles: BTreeSet<u8>,
    pub read_layers: BTreeSet<Layer>,
    pub write_layers: BTreeSet<Layer>,
    pub keys: Vec<PhysicalKey>,
    pub evidence: String,
}
impl Capability {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.identity.interface.link != Link::DirectUsb
            || self.identity.interface.report_id != 0
            || self.identity.interface.payload_bytes != 64
            || self.identity.interface.descriptor_hash.len() != 64
            || self.evidence.is_empty()
        {
            return Err(READ_ONLY);
        }
        if !self.write_layers.is_subset(&self.read_layers)
            || self.keys.len() > SLOTS
            || self.profiles.is_empty()
            || self.profiles.iter().any(|p| *p > 15)
        {
            return Err(INVALID);
        }
        let mut ids = BTreeSet::new();
        let mut slots = BTreeSet::new();
        for key in &self.keys {
            if !valid_id(&key.id) || !ids.insert(&key.id) || !slots.insert(key.slot.index()) {
                return Err(INVALID);
            }
        }
        Ok(())
    }
    pub(crate) fn key(&self, id: &str) -> Result<&PhysicalKey> {
        self.keys.iter().find(|key| key.id == id).ok_or(INVALID)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub schema: u8,
    pub snapshot_id: String,
    pub identity_hash: String,
    pub capability_id: String,
    pub layout_id: String,
    pub profile: u8,
    pub captured_unix_ms: u64,
    #[serde(deserialize_with = "deserialize_layers")]
    pub layers: BTreeMap<Layer, String>,
    pub scope: String,
    pub content_hash: String,
}
impl Snapshot {
    pub(crate) fn new(
        id: String,
        identity: &Identity,
        capability: &Capability,
        profile: Profile,
        captured_unix_ms: u64,
        layers: &BTreeMap<Layer, Keymap>,
    ) -> Self {
        let mut snapshot = Self { schema: 1, snapshot_id: id, identity_hash: identity.binding_hash(), capability_id: capability.record_id.clone(), layout_id: capability.layout_id.clone(), profile: profile.wire(), captured_unix_ms, layers: layers.iter().map(|(name,map)| (*name,map.bytes().iter().map(|b|format!("{b:02x}")).collect())).collect(), scope: "current-profile keymap only; excludes macro bodies, lighting, firmware and all other settings".into(), content_hash: String::new() };
        snapshot.content_hash = snapshot.calculate_hash();
        snapshot
    }
    fn calculate_hash(&self) -> String {
        let mut copy = self.clone();
        copy.content_hash.clear();
        digest(&serde_json::to_vec(&copy).expect("snapshot is serializable"))
    }
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_FRAME {
            return Err(INVALID);
        }
        let value: Self = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
        if value.schema != 1
            || !valid_id(&value.snapshot_id)
            || value.content_hash != value.calculate_hash()
            || value.layers.is_empty()
            || value.layers.len() > 2
            || value.profile > 15
        {
            return Err(INVALID);
        }
        value.maps()?;
        Ok(value)
    }
    pub(crate) fn maps(&self) -> Result<BTreeMap<Layer, Keymap>> {
        self.layers
            .iter()
            .map(|(layer, hex)| {
                if hex.len() != 1024 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(INVALID);
                }
                let bytes: Result<Vec<u8>> = hex
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|s| {
                        let s = std::str::from_utf8(s).map_err(|_| INVALID)?;
                        u8::from_str_radix(s, 16).map_err(|_| INVALID)
                    })
                    .collect();
                Ok((*layer, Keymap::from_bytes(&bytes?)?))
            })
            .collect()
    }
}

fn deserialize_layers<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<Layer, String>, D::Error> {
    struct Layers;
    impl<'de> serde::de::Visitor<'de> for Layers {
        type Value = BTreeMap<Layer, String>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("unique fixed base/Fn layers")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> std::result::Result<Self::Value, M::Error> {
            let mut layers = BTreeMap::new();
            while let Some((layer, data)) = map.next_entry::<Layer, String>()? {
                if layers.insert(layer, data).is_some() {
                    return Err(serde::de::Error::custom("duplicate layer"));
                }
            }
            Ok(layers)
        }
    }
    deserializer.deserialize_map(Layers)
}
