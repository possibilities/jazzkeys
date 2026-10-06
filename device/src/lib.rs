//! The release worker has no HID backend and no writable capability records.
//! Device operations are deliberately private; only bounded semantic IPC is public.
#![forbid(unsafe_code)]
#[allow(dead_code)]
mod domain;
#[allow(dead_code)]
mod engine;
mod ipc;
#[allow(dead_code)]
mod protocol;
#[allow(dead_code)]
mod storage;

pub use ipc::run;

#[cfg(test)]
mod tests;
