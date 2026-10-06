//! Metadata policy only: no OS enumeration, device open, reports, or capability.
//! Every observation is supplied by a future separately reviewed OS provider.
//! A matching USB identity is a research candidate, never read/write authority.
use crate::domain::{Fault, Result, digest};
use serde::Serialize;

const MAX_DESCRIPTOR_BYTES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum OsTransport {
    Usb,
    Bluetooth,
    Other,
    Unknown,
}

/// Deliberately excludes serial numbers, product-label photos, paths, and typing.
/// The OS provider must retain its instance handle privately for later selection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct InterfaceMetadata {
    pub transport: OsTransport,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub usage_page: Option<u16>,
    pub usage: Option<u16>,
    pub interface_number: Option<u8>,
    /// An OS-reported maximum is not proof of a specific feature report shape.
    pub max_feature_report_bytes: Option<u16>,
    pub report_descriptor: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CandidateClass {
    /// The Sharkfin record is from another unit; all protocol evidence is pending.
    Yc500ResearchCandidate,
    /// An official mechanical MAX catalog uses another controller/protocol path.
    DifferentKnownDriver,
    UnrelatedOrIncompleteIdentity,
    WrongTransport,
    WrongCollection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EvidenceGap {
    TransportUnknown,
    CollectionUnknown,
    InterfaceNumberUnknown,
    DescriptorUnknown,
    FeatureSizeUnknown,
    FeatureSizeDoesNotMatchCandidate,
    FeatureFramingUnverified,
    DirectCableUnverified,
    InternalIdentityUnqueried,
    RevisionUnqueried,
    CurrentProfileUnqueried,
    PhysicalSlotMapUnverified,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CandidateAssessment {
    pub class: CandidateClass,
    /// Metadata consistency only, not authentication or device-instance identity.
    pub metadata_hash: String,
    pub gaps: Vec<EvidenceGap>,
}

pub(crate) fn assess(metadata: &InterfaceMetadata) -> Result<CandidateAssessment> {
    if metadata
        .report_descriptor
        .as_ref()
        .is_some_and(|bytes| bytes.is_empty() || bytes.len() > MAX_DESCRIPTOR_BYTES)
        || metadata.max_feature_report_bytes == Some(0)
    {
        return Err(Fault::new(
            "invalid_metadata",
            "OS descriptor metadata is empty or exceeds the reviewed bound",
        ));
    }
    let class = match (metadata.vid, metadata.pid) {
        (Some(0x1a2c), Some(0xa036 | 0xa206 | 0xa207)) => CandidateClass::DifferentKnownDriver,
        (Some(0x3151), Some(0x4015)) => match metadata.transport {
            OsTransport::Bluetooth | OsTransport::Other => CandidateClass::WrongTransport,
            OsTransport::Usb | OsTransport::Unknown => {
                if metadata.usage_page.is_some_and(|page| page != 0xffff)
                    || metadata.usage.is_some_and(|usage| usage != 2)
                {
                    CandidateClass::WrongCollection
                } else {
                    CandidateClass::Yc500ResearchCandidate
                }
            }
        },
        _ => CandidateClass::UnrelatedOrIncompleteIdentity,
    };
    let mut gaps = Vec::new();
    if class == CandidateClass::Yc500ResearchCandidate {
        if metadata.transport == OsTransport::Unknown {
            gaps.push(EvidenceGap::TransportUnknown);
        }
        if metadata.usage_page.is_none() || metadata.usage.is_none() {
            gaps.push(EvidenceGap::CollectionUnknown);
        }
        if metadata.interface_number.is_none() {
            gaps.push(EvidenceGap::InterfaceNumberUnknown);
        }
        if metadata.report_descriptor.is_none() {
            gaps.push(EvidenceGap::DescriptorUnknown);
        }
        match metadata.max_feature_report_bytes {
            None => gaps.push(EvidenceGap::FeatureSizeUnknown),
            Some(64) => {}
            Some(_) => gaps.push(EvidenceGap::FeatureSizeDoesNotMatchCandidate),
        }
        // OS USB metadata alone cannot distinguish a receiver from direct cable,
        // establish the report-ID convention, or supply any vendor reply.
        gaps.extend([
            EvidenceGap::FeatureFramingUnverified,
            EvidenceGap::DirectCableUnverified,
            EvidenceGap::InternalIdentityUnqueried,
            EvidenceGap::RevisionUnqueried,
            EvidenceGap::CurrentProfileUnqueried,
            EvidenceGap::PhysicalSlotMapUnverified,
        ]);
    }
    let bytes = serde_json::to_vec(metadata).expect("metadata has no fallible serialization");
    Ok(CandidateAssessment {
        class,
        metadata_hash: digest(&bytes),
        gaps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> InterfaceMetadata {
        InterfaceMetadata {
            transport: OsTransport::Usb,
            vid: Some(0x3151),
            pid: Some(0x4015),
            usage_page: Some(0xffff),
            usage: Some(2),
            interface_number: Some(2),
            max_feature_report_bytes: Some(64),
            // Synthetic opaque bytes, not a measured or accepted HID descriptor.
            report_descriptor: Some(vec![0x06, 0xff, 0xff, 0x09, 0x02]),
        }
    }

    #[test]
    fn complete_metadata_still_has_no_protocol_or_direct_cable_evidence() {
        let result = assess(&fixture()).unwrap();
        assert_eq!(result.class, CandidateClass::Yc500ResearchCandidate);
        assert_eq!(
            result.gaps,
            vec![
                EvidenceGap::FeatureFramingUnverified,
                EvidenceGap::DirectCableUnverified,
                EvidenceGap::InternalIdentityUnqueried,
                EvidenceGap::RevisionUnqueried,
                EvidenceGap::CurrentProfileUnqueried,
                EvidenceGap::PhysicalSlotMapUnverified,
            ]
        );
    }

    #[test]
    fn another_mechanical_max_identity_never_enters_yc500_policy() {
        for pid in [0xa036, 0xa206, 0xa207] {
            let mut value = fixture();
            value.vid = Some(0x1a2c);
            value.pid = Some(pid);
            value.usage_page = Some(0xff02);
            assert_eq!(
                assess(&value).unwrap().class,
                CandidateClass::DifferentKnownDriver
            );
        }
    }

    #[test]
    fn partial_ids_and_other_models_never_match_by_name_or_vendor_alone() {
        for (vid, pid) in [
            (None, Some(0x4015)),
            (Some(0x3151), None),
            (Some(0x3151), Some(0x4016)),
            (Some(0x1a2c), Some(0x4015)),
        ] {
            let mut value = fixture();
            value.vid = vid;
            value.pid = pid;
            assert_eq!(
                assess(&value).unwrap().class,
                CandidateClass::UnrelatedOrIncompleteIdentity
            );
        }
    }

    #[test]
    fn wrong_bus_and_typing_collections_are_not_configuration_candidates() {
        for transport in [OsTransport::Bluetooth, OsTransport::Other] {
            let mut value = fixture();
            value.transport = transport;
            assert_eq!(
                assess(&value).unwrap().class,
                CandidateClass::WrongTransport
            );
        }
        for (page, usage) in [(1, 6), (0xffff, 1), (0xff02, 2)] {
            let mut value = fixture();
            value.usage_page = Some(page);
            value.usage = Some(usage);
            assert_eq!(
                assess(&value).unwrap().class,
                CandidateClass::WrongCollection
            );
        }
    }

    #[test]
    fn missing_observations_remain_explicitly_unknown() {
        let mut value = fixture();
        value.transport = OsTransport::Unknown;
        value.usage = None;
        value.interface_number = None;
        value.report_descriptor = None;
        value.max_feature_report_bytes = None;
        let result = assess(&value).unwrap();
        for gap in [
            EvidenceGap::TransportUnknown,
            EvidenceGap::CollectionUnknown,
            EvidenceGap::InterfaceNumberUnknown,
            EvidenceGap::DescriptorUnknown,
            EvidenceGap::FeatureSizeUnknown,
        ] {
            assert!(result.gaps.contains(&gap));
        }
    }

    #[test]
    fn missing_usage_component_does_not_hide_a_known_mismatch() {
        let mut value = fixture();
        value.usage_page = Some(1);
        value.usage = None;
        assert_eq!(
            assess(&value).unwrap().class,
            CandidateClass::WrongCollection
        );
        value.usage_page = None;
        value.usage = Some(1);
        assert_eq!(
            assess(&value).unwrap().class,
            CandidateClass::WrongCollection
        );
    }

    #[test]
    fn feature_maximum_is_not_normalized_into_a_payload_length() {
        for size in [8, 63, 65, 512] {
            let mut value = fixture();
            value.max_feature_report_bytes = Some(size);
            assert!(
                assess(&value)
                    .unwrap()
                    .gaps
                    .contains(&EvidenceGap::FeatureSizeDoesNotMatchCandidate)
            );
        }
    }

    #[test]
    fn descriptor_limits_fail_closed_without_padding_or_truncation() {
        for bytes in [vec![], vec![0; MAX_DESCRIPTOR_BYTES + 1]] {
            let mut value = fixture();
            value.report_descriptor = Some(bytes);
            assert_eq!(assess(&value).unwrap_err().code, "invalid_metadata");
        }
        let mut value = fixture();
        value.max_feature_report_bytes = Some(0);
        assert_eq!(assess(&value).unwrap_err().code, "invalid_metadata");
    }

    #[test]
    fn hash_changes_with_each_observed_interface_fact() {
        let value = fixture();
        let original = assess(&value).unwrap().metadata_hash;
        let mut variants = Vec::new();
        let mut changed = value.clone();
        changed.transport = OsTransport::Unknown;
        variants.push(changed);
        let mut changed = value.clone();
        changed.interface_number = Some(3);
        variants.push(changed);
        let mut changed = value.clone();
        changed.report_descriptor.as_mut().unwrap().push(0xc0);
        variants.push(changed);
        let mut changed = value.clone();
        changed.max_feature_report_bytes = Some(65);
        variants.push(changed);
        for changed in variants {
            assert_ne!(assess(&changed).unwrap().metadata_hash, original);
        }
        assert_eq!(assess(&value).unwrap().metadata_hash, original);
    }
}
