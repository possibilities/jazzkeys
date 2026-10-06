//! Durable evidence before wire mutation. Files are private, bounded, never auto-replayed.
use crate::domain::{Entry, Keymap, MAX_FRAME, Result, STORAGE, Snapshot, Target, valid_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct JournalIntent {
    pub plan_id: String,
    pub snapshot_id: String,
    pub session_id: String,
    pub baseline_hash: String,
    pub desired_hash: String,
    pub changes: Vec<JournalChange>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct JournalChange {
    pub physical_key: String,
    pub layer: crate::domain::Layer,
    pub slot: u8,
    pub before: [u8; 4],
    pub after: [u8; 4],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum JournalEvent {
    Prepared {
        intent: JournalIntent,
    },
    Sending {
        physical_key: String,
    },
    Sent {
        physical_key: String,
    },
    NotSent {
        physical_key: String,
    },
    Finished {
        status: String,
        verified_keys: Vec<String>,
        unknown_keys: Vec<String>,
        not_attempted: usize,
        preserved: bool,
        readback_complete: bool,
        readback_hex: Option<String>,
        cancelled: bool,
        reason: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Recovery {
    pub plan_id: String,
    pub snapshot_id: Option<String>,
    pub uncertain: bool,
    pub torn_tail: bool,
}
pub(crate) trait Store {
    fn save_before(&mut self, snapshot: &Snapshot, intent: &JournalIntent) -> Result<()>;
    fn append(&mut self, plan_id: &str, event: &JournalEvent) -> Result<()>;
    fn load_snapshot(&self, snapshot_id: &str) -> Result<Snapshot>;
}
pub(crate) struct FsStore {
    root: PathBuf,
    lock: PathBuf,
}
impl FsStore {
    /// Root must be an app-owned directory, never a path from ordinary IPC.
    /// A crash leaves owner.lock. Reconciliation must deliberately clear it outside this API.
    pub(crate) fn open(root: PathBuf) -> Result<Self> {
        match fs::symlink_metadata(&root) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Err(STORAGE),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&root).map_err(|_| STORAGE)?;
                if let Some(parent) = root.parent() {
                    File::open(parent)
                        .and_then(|f| f.sync_all())
                        .map_err(|_| STORAGE)?;
                }
            }
            Err(_) => return Err(STORAGE),
        }
        #[cfg(unix)]
        if fs::metadata(&root)
            .map_err(|_| STORAGE)?
            .permissions()
            .mode()
            & 0o077
            != 0
        {
            return Err(STORAGE);
        }
        let lock = root.join("owner.lock");
        let mut file = private_new(&lock)?;
        file.write_all(b"Exclusive Jazzkeys evidence owner. Never auto-replay journals.\n")
            .and_then(|_| file.sync_all())
            .map_err(|_| STORAGE)?;
        File::open(&root)
            .and_then(|f| f.sync_all())
            .map_err(|_| STORAGE)?;
        Ok(Self { root, lock })
    }
    fn path(&self, id: &str, suffix: &str) -> Result<PathBuf> {
        if !valid_id(id) {
            return Err(STORAGE);
        }
        Ok(self.root.join(format!("{id}.{suffix}")))
    }
    fn durable_new(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        let temporary = path.with_extension("pending");
        let mut file = private_new(&temporary)?;
        let result = (|| {
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| STORAGE)?;
            // Hard-link installs a complete file without overwriting any existing evidence.
            fs::hard_link(&temporary, path).map_err(|_| STORAGE)?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| STORAGE)?;
            fs::remove_file(&temporary).map_err(|_| STORAGE)?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| STORAGE)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    /// Startup inspection is read-only and cannot issue any transport operation.
    pub(crate) fn inspect(root: &Path) -> Result<Vec<Recovery>> {
        let meta = fs::symlink_metadata(root).map_err(|_| STORAGE)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(STORAGE);
        }
        let mut result = Vec::new();
        for entry in fs::read_dir(root).map_err(|_| STORAGE)? {
            let path = entry.map_err(|_| STORAGE)?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("journal") {
                continue;
            }
            if result.len() >= 1024 {
                return Err(STORAGE);
            }
            let bytes = read_regular(&path, 1024 * 1024)?;
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| valid_id(s))
                .ok_or(STORAGE)?
                .to_string();
            let torn_tail = !bytes.ends_with(b"\n");
            let mut snapshot_id = None;
            let mut resolved = false;
            let mut intent: Option<JournalIntent> = None;
            let mut original: Option<Keymap> = None;
            let mut attempted: Vec<String> = Vec::new();
            let mut pending: Option<String> = None;
            let mut terminal = false;
            let mut lines = bytes.split(|b| *b == b'\n').peekable();
            while let Some(line) = lines.next() {
                if line.is_empty() {
                    if lines.peek().is_some() {
                        return Err(STORAGE);
                    }
                    continue;
                }
                if torn_tail && lines.peek().is_none() {
                    break;
                }
                if line.len() > MAX_FRAME || terminal {
                    return Err(STORAGE);
                }
                let event: JournalEvent = serde_json::from_slice(line).map_err(|_| STORAGE)?;
                match event {
                    JournalEvent::Prepared { intent: prepared } => {
                        if intent.is_some() || prepared.plan_id != name {
                            return Err(STORAGE);
                        }
                        if !valid_id(&prepared.snapshot_id) {
                            return Err(STORAGE);
                        }
                        let snapshot = Snapshot::parse(&read_regular(
                            &root.join(format!("{}.snapshot", prepared.snapshot_id)),
                            MAX_FRAME,
                        )?)
                        .map_err(|_| STORAGE)?;
                        validate_intent(&snapshot, &prepared)?;
                        original = Some(
                            snapshot
                                .maps()
                                .map_err(|_| STORAGE)?
                                .into_values()
                                .next()
                                .ok_or(STORAGE)?,
                        );
                        snapshot_id = Some(prepared.snapshot_id.clone());
                        intent = Some(prepared);
                    }
                    JournalEvent::Sending { physical_key } => {
                        let prepared = intent.as_ref().ok_or(STORAGE)?;
                        if pending.is_some()
                            || prepared
                                .changes
                                .get(attempted.len())
                                .map(|change| change.physical_key.as_str())
                                != Some(physical_key.as_str())
                        {
                            return Err(STORAGE);
                        }
                        attempted.push(physical_key.clone());
                        pending = Some(physical_key);
                    }
                    JournalEvent::Sent { physical_key } => {
                        if pending.take().as_deref() != Some(physical_key.as_str()) {
                            return Err(STORAGE);
                        }
                    }
                    JournalEvent::NotSent { physical_key } => {
                        if pending.take().as_deref() != Some(physical_key.as_str())
                            || attempted.pop().as_deref() != Some(physical_key.as_str())
                        {
                            return Err(STORAGE);
                        }
                    }
                    JournalEvent::Finished {
                        status,
                        verified_keys,
                        unknown_keys,
                        not_attempted,
                        preserved,
                        readback_complete,
                        readback_hex,
                        cancelled,
                        reason,
                    } => {
                        let prepared = intent.as_ref().ok_or(STORAGE)?;
                        let verified: BTreeSet<_> = verified_keys.iter().collect();
                        let unknown: BTreeSet<_> = unknown_keys.iter().collect();
                        let sent: BTreeSet<_> = attempted.iter().collect();
                        if verified.len() != verified_keys.len()
                            || unknown.len() != unknown_keys.len()
                            || !verified.is_disjoint(&unknown)
                            || !verified.is_subset(&sent)
                            || !unknown.is_subset(&sent)
                            || not_attempted != prepared.changes.len() - attempted.len()
                        {
                            return Err(STORAGE);
                        }
                        if !matches!(
                            status.as_str(),
                            "verified" | "cancelled" | "partial" | "rejected" | "uncertain"
                        ) || pending.is_some() && status != "uncertain"
                        {
                            return Err(STORAGE);
                        }
                        if readback_complete != readback_hex.is_some() {
                            return Err(STORAGE);
                        }
                        if let Some(hex) = readback_hex {
                            let actual = Keymap::from_hex(&hex).map_err(|_| STORAGE)?;
                            let original = original.as_ref().ok_or(STORAGE)?;
                            let requested = &prepared.changes[..attempted.len()];
                            let expected_verified: BTreeSet<_> = requested
                                .iter()
                                .filter(|change| {
                                    actual.0[usize::from(change.slot)].0 == change.after
                                })
                                .map(|change| &change.physical_key)
                                .collect();
                            let slots: BTreeSet<_> = requested
                                .iter()
                                .map(|change| usize::from(change.slot))
                                .collect();
                            let actual_preserved = (0..128)
                                .filter(|slot| !slots.contains(slot))
                                .all(|slot| actual.0[slot] == original.0[slot]);
                            if expected_verified != verified || actual_preserved != preserved {
                                return Err(STORAGE);
                            }
                            if status == "rejected"
                                && requested.iter().any(|change| {
                                    actual.0[usize::from(change.slot)].0 != change.before
                                })
                            {
                                return Err(STORAGE);
                            }
                        }
                        if readback_complete && !unknown.is_empty()
                            || !readback_complete && !verified.is_empty()
                        {
                            return Err(STORAGE);
                        }
                        if status == "uncertain" && !readback_complete && unknown != sent {
                            return Err(STORAGE);
                        }
                        if matches!(status.as_str(), "partial" | "rejected")
                            && !attempted.is_empty()
                            && !readback_complete
                        {
                            return Err(STORAGE);
                        }
                        if status == "verified"
                            && (!readback_complete
                                || verified.len() != prepared.changes.len()
                                || !unknown.is_empty()
                                || not_attempted != 0
                                || !preserved
                                || cancelled
                                || reason.is_some())
                        {
                            return Err(STORAGE);
                        }
                        if status == "cancelled"
                            && (!attempted.is_empty()
                                || !verified.is_empty()
                                || !unknown.is_empty()
                                || !preserved
                                || !cancelled
                                || reason.is_some())
                        {
                            return Err(STORAGE);
                        }
                        resolved = matches!(status.as_str(), "verified" | "cancelled");
                        terminal = true;
                    }
                }
            }
            result.push(Recovery {
                plan_id: name,
                snapshot_id,
                uncertain: !resolved || torn_tail,
                torn_tail,
            });
        }
        result.sort_by(|a, b| a.plan_id.cmp(&b.plan_id));
        Ok(result)
    }
}
impl Store for FsStore {
    fn save_before(&mut self, snapshot: &Snapshot, intent: &JournalIntent) -> Result<()> {
        validate_intent(snapshot, intent)?;
        let bytes = serde_json::to_vec(snapshot).map_err(|_| STORAGE)?;
        if bytes.len() > MAX_FRAME {
            return Err(STORAGE);
        }
        let path = self.path(&snapshot.snapshot_id, "snapshot")?;
        self.durable_new(&path, &bytes)?;
        if self.load_snapshot(&snapshot.snapshot_id)? != *snapshot {
            return Err(STORAGE);
        }
        let mut header = serde_json::to_vec(&JournalEvent::Prepared {
            intent: intent.clone(),
        })
        .map_err(|_| STORAGE)?;
        header.push(b'\n');
        let journal = self.path(&intent.plan_id, "journal")?;
        self.durable_new(&journal, &header)?;
        if read_regular(&journal, MAX_FRAME)? != header {
            return Err(STORAGE);
        }
        Ok(())
    }
    fn append(&mut self, plan_id: &str, event: &JournalEvent) -> Result<()> {
        let path = self.path(plan_id, "journal")?;
        let meta = fs::symlink_metadata(&path).map_err(|_| STORAGE)?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 1024 * 1024 {
            return Err(STORAGE);
        }
        let mut bytes = serde_json::to_vec(event).map_err(|_| STORAGE)?;
        bytes.push(b'\n');
        if bytes.len() > MAX_FRAME {
            return Err(STORAGE);
        }
        let mut options = OpenOptions::new();
        options.append(true);
        no_follow(&mut options);
        let mut file = options.open(path).map_err(|_| STORAGE)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| STORAGE)
    }
    fn load_snapshot(&self, id: &str) -> Result<Snapshot> {
        Snapshot::parse(&read_regular(&self.path(id, "snapshot")?, MAX_FRAME)?).map_err(|_| STORAGE)
    }
}
impl Drop for FsStore {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock);
        let _ = File::open(&self.root).and_then(|f| f.sync_all());
    }
}
fn no_follow(options: &mut OpenOptions) {
    #[cfg(target_os = "linux")]
    {
        options.custom_flags(0x20000);
    } // O_NOFOLLOW; no unsafe/libc dependency.
    #[cfg(target_os = "macos")]
    {
        options.custom_flags(0x100);
    }
}
fn private_new(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    no_follow(&mut options);
    options.open(path).map_err(|_| STORAGE)
}
fn read_regular(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path).map_err(|_| STORAGE)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit as u64 {
        return Err(STORAGE);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    no_follow(&mut options);
    let file = options.open(path).map_err(|_| STORAGE)?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| STORAGE)?;
    if bytes.len() > limit {
        return Err(STORAGE);
    }
    Ok(bytes)
}

fn validate_intent(snapshot: &Snapshot, intent: &JournalIntent) -> Result<()> {
    if intent.snapshot_id != snapshot.snapshot_id
        || !valid_id(&intent.plan_id)
        || !valid_id(&intent.session_id)
        || intent.changes.is_empty()
        || intent.changes.len() > 128
    {
        return Err(STORAGE);
    }
    let maps = snapshot.maps().map_err(|_| STORAGE)?;
    if maps.len() != 1 {
        return Err(STORAGE);
    }
    let (layer, map) = maps.iter().next().ok_or(STORAGE)?;
    if map.hash() != intent.baseline_hash {
        return Err(STORAGE);
    }
    let mut desired = map.clone();
    let mut ids = BTreeSet::new();
    let mut slots = BTreeSet::new();
    for change in &intent.changes {
        let slot = usize::from(change.slot);
        if slot >= 128
            || change.layer != *layer
            || !valid_id(&change.physical_key)
            || !ids.insert(&change.physical_key)
            || !slots.insert(slot)
            || map.0[slot].0 != change.before
            || change.before == change.after
            || Target::from_entry(Entry(change.before)).is_none()
            || Target::from_entry(Entry(change.after)).is_none()
        {
            return Err(STORAGE);
        }
        desired.0[slot] = Entry(change.after);
    }
    if desired.hash() != intent.desired_hash {
        return Err(STORAGE);
    }
    Ok(())
}
