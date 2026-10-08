//! Messages for the host's typed edit failures, so a callback returning
//! `Result<_, String>` can `?` a rejected edit.
use crate::bindings::diffr::plugin::types::{Grouping, MoveError};

fn grouping(grouping: Grouping) -> &'static str {
    match grouping {
        Grouping::Link => "a link",
        Grouping::Join => "a join",
    }
}

impl From<MoveError> for String {
    fn from(error: MoveError) -> Self {
        match error {
            MoveError::NoRegion(id) => format!("no region {id}"),
            MoveError::CutFold(id) => format!("region {id} is a fold; only a leaf can be cut"),
            MoveError::CutOutside(e) => format!(
                "line {} is not inside region {}, which has {} lines",
                e.offset, e.id, e.len
            ),
            MoveError::UnevenSides(id) => {
                format!("region {id} has a different length on each side")
            }
            MoveError::TooFewRegions(g) => format!("{} needs at least two regions", grouping(g)),
            MoveError::Repeated(e) => {
                format!("{} lists a region twice: {:?}", grouping(e.grouping), e.ids)
            }
            MoveError::OneSided(ids) => {
                format!("a side holds only one of the joined regions {ids:?}")
            }
            MoveError::NotSiblings(ids) => {
                format!("the joined regions {ids:?} are not consecutive siblings")
            }
            MoveError::NoNextSibling(id) => format!("region {id} has no next sibling"),
        }
    }
}
