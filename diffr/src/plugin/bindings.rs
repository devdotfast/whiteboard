//! The host's side of the plugin contract, generated from the SDK's WIT.
//! A `cursor` resource is the engine's [`Cursor`](diffr_core::plugin::cursor::Cursor).
//! The engine speaks its own types; the conversions below are the only
//! place the contract's records meet them.
use diffr_core::pairing::Pairing;
use diffr_core::plugin::cursor;
use diffr_core::protocol::{self, FileChange, FileStatus};

wasmtime::component::bindgen!({
    path: "wit/plugin.wit",
    world: "diffr-plugin",
    with: { "diffr:plugin/host.cursor": diffr_core::plugin::cursor::Cursor },
    imports: { default: trappable },
    exports: { default: async | store },
    additional_derives: [PartialEq, Eq],
});

pub(crate) use diffr::plugin::types;

/// The classifier's world.
pub(crate) mod classifier {
    wasmtime::component::bindgen!({
        path: "wit/plugin.wit",
        world: "diffr-classifier",
        with: {
            "diffr:plugin/types": super::diffr::plugin::types,
            "diffr:plugin/git": super::diffr::plugin::git,
        },
        imports: { default: trappable },
        exports: { default: async | store },
    });
}

impl From<&FileChange> for types::FileEntry {
    fn from(file: &FileChange) -> Self {
        let file_ref = |side: &protocol::FileRef| types::FileRef {
            path: side.path.clone(),
            oid: side.oid.clone(),
            mode: side.mode.clone(),
        };
        Self {
            file: match &file.file {
                Pairing::Both { lhs, rhs } => {
                    types::FileSides::Both((file_ref(lhs), file_ref(rhs)))
                }
                Pairing::LeftOnly { lhs } => types::FileSides::LeftOnly(file_ref(lhs)),
                Pairing::RightOnly { rhs } => types::FileSides::RightOnly(file_ref(rhs)),
            },
            status: match file.status {
                FileStatus::Added => types::FileStatus::Added,
                FileStatus::Deleted => types::FileStatus::Deleted,
                FileStatus::Modified => types::FileStatus::Modified,
                FileStatus::Renamed => types::FileStatus::Renamed,
                FileStatus::Copied => types::FileStatus::Copied,
                FileStatus::TypeChanged => types::FileStatus::TypeChanged,
            },
            tags: file.tags.clone(),
        }
    }
}

impl From<types::Side> for cursor::Side {
    fn from(side: types::Side) -> Self {
        match side {
            types::Side::Lhs => Self::Lhs,
            types::Side::Rhs => Self::Rhs,
        }
    }
}

impl From<cursor::Side> for types::Side {
    fn from(side: cursor::Side) -> Self {
        match side {
            cursor::Side::Lhs => Self::Lhs,
            cursor::Side::Rhs => Self::Rhs,
        }
    }
}

/// The region part of a view: what `ancestors` lists.
impl From<cursor::RegionView> for types::Region {
    fn from(view: cursor::RegionView) -> Self {
        let position = |position: protocol::SourcePos| types::Position {
            line: position.line,
            column: position.column,
        };
        Self {
            id: view.id,
            parent: view.parent,
            fold_state_id: view.fold_state_id,
            range: types::Range {
                start: position(view.range.start),
                end: position(view.range.end),
            },
            tags: view.tags,
            visibility: types::Visibility {
                collapsed: view.visibility.collapsed,
                label: view.visibility.label,
            },
            kind: match view.kind {
                cursor::Kind::Leaf {
                    alignment_id,
                    changed,
                } => types::Kind::Leaf(types::Leaf {
                    alignment_id,
                    changed: changed
                        .into_iter()
                        .map(|span| types::Span {
                            line: span.line,
                            start_column: span.start_column,
                            end_column: span.end_column,
                        })
                        .collect(),
                }),
                cursor::Kind::Fold => types::Kind::Fold,
            },
        }
    }
}

impl From<cursor::RegionView> for types::RegionView {
    fn from(view: cursor::RegionView) -> Self {
        Self {
            side: view.side.into(),
            children: view.children.clone(),
            data: view.into(),
        }
    }
}

impl From<cursor::RegionIds> for types::RegionIds {
    fn from(ids: cursor::RegionIds) -> Self {
        match ids {
            cursor::RegionIds::Both(lhs, rhs) => Self::Both((lhs, rhs)),
            cursor::RegionIds::LeftOnly(lhs) => Self::LeftOnly(lhs),
            cursor::RegionIds::RightOnly(rhs) => Self::RightOnly(rhs),
        }
    }
}

impl From<cursor::RowSummary> for types::RowSummary {
    fn from(summary: cursor::RowSummary) -> Self {
        Self {
            collapsed: summary.collapsed,
            leading: summary.leading,
            trailing: summary.trailing,
            longest_gap: summary.longest_gap,
        }
    }
}

impl From<cursor::Grouping> for types::Grouping {
    fn from(grouping: cursor::Grouping) -> Self {
        match grouping {
            cursor::Grouping::Link => Self::Link,
            cursor::Grouping::Join => Self::Join,
        }
    }
}

impl From<cursor::MoveError> for types::MoveError {
    fn from(error: cursor::MoveError) -> Self {
        match error {
            cursor::MoveError::NoRegion(id) => Self::NoRegion(id),
            cursor::MoveError::CutFold(id) => Self::CutFold(id),
            cursor::MoveError::CutOutside { id, offset, len } => {
                Self::CutOutside(types::CutOutside { id, offset, len })
            }
            cursor::MoveError::UnevenSides(id) => Self::UnevenSides(id),
            cursor::MoveError::TooFewRegions(grouping) => Self::TooFewRegions(grouping.into()),
            cursor::MoveError::Repeated { grouping, ids } => Self::Repeated(types::Repeated {
                grouping: grouping.into(),
                ids,
            }),
            cursor::MoveError::OneSided(ids) => Self::OneSided(ids),
            cursor::MoveError::NotSiblings(ids) => Self::NotSiblings(ids),
            cursor::MoveError::NoNextSibling(id) => Self::NoNextSibling(id),
        }
    }
}
