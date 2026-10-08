//! Which sides of a comparison a thing exists on.
//!
//! Sides are always `lhs` (before) and `rhs` (after). On the wire a
//! `Pairing` serializes by presence: `{lhs, rhs}`, `{lhs}`, or `{rhs}`.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Which sides a thing exists on. Serializes by presence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pairing<T> {
    Both { lhs: T, rhs: T },
    LeftOnly { lhs: T },
    RightOnly { rhs: T },
}

impl<T> Pairing<T> {
    /// The same sides, each value transformed by `f`.
    pub(crate) fn map<U>(self, mut f: impl FnMut(T) -> U) -> Pairing<U> {
        match self {
            Self::Both { lhs, rhs } => Pairing::Both {
                lhs: f(lhs),
                rhs: f(rhs),
            },
            Self::LeftOnly { lhs } => Pairing::LeftOnly { lhs: f(lhs) },
            Self::RightOnly { rhs } => Pairing::RightOnly { rhs: f(rhs) },
        }
    }

    pub fn lhs(&self) -> Option<&T> {
        match self {
            Self::Both { lhs, .. } | Self::LeftOnly { lhs } => Some(lhs),
            Self::RightOnly { .. } => None,
        }
    }

    pub fn rhs(&self) -> Option<&T> {
        match self {
            Self::Both { rhs, .. } | Self::RightOnly { rhs } => Some(rhs),
            Self::LeftOnly { .. } => None,
        }
    }

    /// Every side that exists, lhs first.
    pub(crate) fn sides(&self) -> Vec<&T> {
        match self {
            Self::Both { lhs, rhs } => vec![lhs, rhs],
            Self::LeftOnly { lhs } => vec![lhs],
            Self::RightOnly { rhs } => vec![rhs],
        }
    }
}

#[derive(Serialize, Deserialize)]
struct PairingRepr<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    lhs: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rhs: Option<T>,
}

impl<T: Serialize> Serialize for Pairing<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let repr = match self {
            Self::Both { lhs, rhs } => PairingRepr {
                lhs: Some(lhs),
                rhs: Some(rhs),
            },
            Self::LeftOnly { lhs } => PairingRepr {
                lhs: Some(lhs),
                rhs: None,
            },
            Self::RightOnly { rhs } => PairingRepr {
                lhs: None,
                rhs: Some(rhs),
            },
        };
        repr.serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Pairing<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match PairingRepr::deserialize(deserializer)? {
            PairingRepr {
                lhs: Some(lhs),
                rhs: Some(rhs),
            } => Ok(Self::Both { lhs, rhs }),
            PairingRepr {
                lhs: Some(lhs),
                rhs: None,
            } => Ok(Self::LeftOnly { lhs }),
            PairingRepr {
                lhs: None,
                rhs: Some(rhs),
            } => Ok(Self::RightOnly { rhs }),
            PairingRepr {
                lhs: None,
                rhs: None,
            } => Err(D::Error::custom("a pairing needs at least one side")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_pairing_needs_a_side() {
        let error = serde_json::from_value::<Pairing<u32>>(json!({})).unwrap_err();
        assert!(error.to_string().contains("at least one side"));
        assert_eq!(
            serde_json::from_value::<Pairing<u32>>(json!({"rhs": 7})).unwrap(),
            Pairing::RightOnly { rhs: 7 }
        );
    }
}
