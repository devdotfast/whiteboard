//! The plugin contract as plain Rust, for a host that links plugins into
//! itself instead of running their components: diffr in the browser, where
//! no component runtime runs. The modules mirror the paths and shapes
//! `wit_bindgen` generates from `wit/plugin.wit`, so a plugin's source
//! compiles unchanged against either. The host implements [`CursorHost`]
//! and [`GitHost`]; the export macros expand to nothing, since the host
//! names each plugin's type itself.
use std::any::Any;
use std::cell::RefCell;

pub mod bindings {
    pub mod diffr {
        pub mod plugin {
            pub mod types {
                #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
                pub enum Visit {
                    Pre,
                    Post,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
                pub enum Side {
                    Lhs,
                    Rhs,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
                pub enum FileStatus {
                    Added,
                    Deleted,
                    Modified,
                    Renamed,
                    Copied,
                    TypeChanged,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct FileRef {
                    pub path: String,
                    pub oid: String,
                    pub mode: String,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub enum FileSides {
                    Both((FileRef, FileRef)),
                    LeftOnly(FileRef),
                    RightOnly(FileRef),
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct FileEntry {
                    pub file: FileSides,
                    pub status: FileStatus,
                    pub tags: Vec<String>,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub struct Position {
                    pub line: u32,
                    pub column: u32,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub struct Range {
                    pub start: Position,
                    pub end: Position,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub struct Span {
                    pub line: u32,
                    pub start_column: u32,
                    pub end_column: u32,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct Visibility {
                    pub collapsed: bool,
                    pub label: String,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct Leaf {
                    pub alignment_id: u32,
                    pub changed: Vec<Span>,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub enum Kind {
                    Leaf(Leaf),
                    Fold,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct Region {
                    pub id: u32,
                    pub parent: Option<u32>,
                    pub fold_state_id: u32,
                    pub range: Range,
                    pub tags: Vec<String>,
                    pub visibility: Visibility,
                    pub kind: Kind,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct RegionView {
                    pub side: Side,
                    pub data: Region,
                    pub children: Vec<u32>,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub enum RegionIds {
                    Both((u32, u32)),
                    LeftOnly(u32),
                    RightOnly(u32),
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub struct RowSummary {
                    pub collapsed: u32,
                    pub leading: u32,
                    pub trailing: u32,
                    pub longest_gap: u32,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
                pub enum Grouping {
                    Link,
                    Join,
                }

                #[derive(Clone, Copy, Debug, PartialEq, Eq)]
                pub struct CutOutside {
                    pub id: u32,
                    pub offset: u32,
                    pub len: u32,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub struct Repeated {
                    pub grouping: Grouping,
                    pub ids: Vec<u32>,
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub enum MoveError {
                    NoRegion(u32),
                    CutFold(u32),
                    CutOutside(CutOutside),
                    UnevenSides(u32),
                    TooFewRegions(Grouping),
                    Repeated(Repeated),
                    OneSided(Vec<u32>),
                    NotSiblings(Vec<u32>),
                    NoNextSibling(u32),
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub enum Tag {
                    Generated,
                    Vendored,
                    Docs,
                    Test,
                    Custom(String),
                }

                #[derive(Clone, Debug, PartialEq, Eq)]
                pub enum Attribute {
                    Unspecified,
                    Unset,
                    Set,
                    Value(String),
                }
            }

            pub mod host {
                use super::types::{
                    FileEntry, MoveError, Region, RegionIds, RegionView, RowSummary, Side,
                };
                use crate::native::CursorHost;
                use std::cell::RefCell;

                /// The host's cursor over one file's trees.
                pub struct Cursor(pub(crate) RefCell<Box<dyn CursorHost>>);

                impl Cursor {
                    pub fn file(&self) -> FileEntry {
                        self.0.borrow().file()
                    }
                    pub fn id(&self) -> u32 {
                        self.0.borrow().id()
                    }
                    pub fn siblings(&self, id: u32) -> Result<Vec<u32>, MoveError> {
                        self.0.borrow().siblings(id)
                    }
                    pub fn ancestors(&self, id: u32) -> Result<Vec<Region>, MoveError> {
                        self.0.borrow().ancestors(id)
                    }
                    pub fn get(&self, id: u32) -> Result<RegionView, MoveError> {
                        self.0.borrow().get(id)
                    }
                    pub fn text(&self, id: u32) -> Result<String, MoveError> {
                        self.0.borrow().text(id)
                    }
                    pub fn display(&self, id: u32) -> Result<RowSummary, MoveError> {
                        self.0.borrow().display(id)
                    }
                    pub fn matching_siblings(
                        &self,
                        ids: &[u32],
                    ) -> Result<Option<Vec<u32>>, MoveError> {
                        self.0.borrow().matching_siblings(ids)
                    }
                    pub fn leaves(&self, side: Side, start: u32, end: u32) -> Vec<u32> {
                        self.0.borrow().leaves(side, start, end)
                    }
                    pub fn has_changes(&self, id: u32) -> Result<bool, MoveError> {
                        self.0.borrow().has_changes(id)
                    }
                    pub fn paired_leaf(&self, id: u32) -> Result<Option<u32>, MoveError> {
                        self.0.borrow().paired_leaf(id)
                    }
                    pub fn linked_regions(&self, id: u32) -> Result<Vec<u32>, MoveError> {
                        self.0.borrow().linked_regions(id)
                    }
                    pub fn is_one_sided(&self, id: u32) -> Result<bool, MoveError> {
                        self.0.borrow().is_one_sided(id)
                    }
                    pub fn source(&self, side: Side) -> Option<String> {
                        self.0.borrow().source(side)
                    }
                    pub fn cut(&self, region: u32, offset: u32) -> Result<RegionIds, MoveError> {
                        self.0.borrow_mut().cut(region, offset)
                    }
                    pub fn join(&self, regions: &[u32]) -> Result<RegionIds, MoveError> {
                        self.0.borrow_mut().join(regions)
                    }
                    pub fn link(&self, regions: &[u32]) -> Result<(), MoveError> {
                        self.0.borrow_mut().link(regions)
                    }
                    pub fn set_collapsed(
                        &self,
                        region: u32,
                        collapsed: bool,
                    ) -> Result<(), MoveError> {
                        self.0.borrow_mut().set_collapsed(region, collapsed)
                    }
                    pub fn set_label(
                        &self,
                        region: u32,
                        label: Option<&str>,
                    ) -> Result<(), MoveError> {
                        self.0.borrow_mut().set_label(region, label)
                    }
                }
            }

            pub mod git {
                use super::types::Attribute;

                pub fn check_attr(
                    attributes: &[String],
                    path: &str,
                ) -> Result<Vec<Attribute>, String> {
                    crate::native::with_git(|git| git.check_attr(attributes, path))
                }

                pub fn cat_file(object: &str) -> Result<Vec<u8>, String> {
                    crate::native::with_git(|git| git.cat_file(object))
                }
            }
        }
    }

    pub mod exports {
        pub mod diffr {
            pub mod plugin {
                pub mod api {
                    use crate::bindings::diffr::plugin::host::Cursor;
                    use crate::bindings::diffr::plugin::types::Visit;

                    pub trait Guest {
                        type Plugin: GuestPlugin;
                    }

                    #[allow(async_fn_in_trait)]
                    pub trait GuestPlugin: Sized + 'static {
                        fn new(options: String) -> Result<Self, String>;
                        async fn visit(
                            &self,
                            cursor: &Cursor,
                            phase: Visit,
                        ) -> Result<bool, String>;
                    }
                }
            }
        }
    }
}

pub mod classifier {
    pub mod exports {
        pub mod diffr {
            pub mod plugin {
                pub mod classify {
                    use crate::bindings::diffr::plugin::types::{FileEntry, Tag};

                    #[derive(Clone, Debug, PartialEq, Eq)]
                    pub struct Classification {
                        pub tags: Vec<Tag>,
                        pub hidden: Option<String>,
                    }

                    pub trait Guest {
                        type Classifier: GuestClassifier;
                    }

                    pub trait GuestClassifier: Sized + 'static {
                        fn new(options: String) -> Result<Self, String>;
                        fn classify(&self, file: FileEntry) -> Result<Classification, String>;
                    }
                }
            }
        }
    }
}

use bindings::diffr::plugin::host::Cursor;
use bindings::diffr::plugin::types::{
    Attribute, FileEntry, MoveError, Region, RegionIds, RegionView, RowSummary, Side,
};

/// The host's side of a [`Cursor`]: one file's trees, positioned on a node.
pub trait CursorHost: Any {
    fn file(&self) -> FileEntry;
    fn id(&self) -> u32;
    fn siblings(&self, id: u32) -> Result<Vec<u32>, MoveError>;
    fn ancestors(&self, id: u32) -> Result<Vec<Region>, MoveError>;
    fn get(&self, id: u32) -> Result<RegionView, MoveError>;
    fn text(&self, id: u32) -> Result<String, MoveError>;
    fn display(&self, id: u32) -> Result<RowSummary, MoveError>;
    fn matching_siblings(&self, ids: &[u32]) -> Result<Option<Vec<u32>>, MoveError>;
    fn leaves(&self, side: Side, start: u32, end: u32) -> Vec<u32>;
    fn has_changes(&self, id: u32) -> Result<bool, MoveError>;
    fn paired_leaf(&self, id: u32) -> Result<Option<u32>, MoveError>;
    fn linked_regions(&self, id: u32) -> Result<Vec<u32>, MoveError>;
    fn is_one_sided(&self, id: u32) -> Result<bool, MoveError>;
    fn source(&self, side: Side) -> Option<String>;
    fn cut(&mut self, region: u32, offset: u32) -> Result<RegionIds, MoveError>;
    fn join(&mut self, regions: &[u32]) -> Result<RegionIds, MoveError>;
    fn link(&mut self, regions: &[u32]) -> Result<(), MoveError>;
    fn set_collapsed(&mut self, region: u32, collapsed: bool) -> Result<(), MoveError>;
    fn set_label(&mut self, region: u32, label: Option<&str>) -> Result<(), MoveError>;
}

impl Cursor {
    /// A cursor a plugin walks, over the host's trees.
    pub fn new(host: Box<dyn CursorHost>) -> Self {
        Self(RefCell::new(host))
    }

    /// The host's side, to position the cursor between visits.
    pub fn host_mut(&self) -> std::cell::RefMut<'_, Box<dyn CursorHost>> {
        self.0.borrow_mut()
    }

    /// The host's trees back, once every plugin has walked them.
    pub fn into_host(self) -> Box<dyn CursorHost> {
        self.0.into_inner()
    }
}

/// The host's side of the `git` interface: the repository being diffed.
pub trait GitHost {
    fn check_attr(&self, attributes: &[String], path: &str) -> Result<Vec<Attribute>, String>;
    fn cat_file(&self, object: &str) -> Result<Vec<u8>, String>;
}

thread_local! {
    static GIT: RefCell<Option<Box<dyn GitHost>>> = const { RefCell::new(None) };
}

/// Answer the plugins' `git` calls on this thread with `git` until the
/// returned guard drops.
pub fn set_git(git: Box<dyn GitHost>) -> GitGuard {
    GIT.with(|slot| *slot.borrow_mut() = Some(git));
    GitGuard(())
}

pub struct GitGuard(());

impl Drop for GitGuard {
    fn drop(&mut self) {
        GIT.with(|slot| *slot.borrow_mut() = None);
    }
}

fn with_git<T>(call: impl FnOnce(&dyn GitHost) -> Result<T, String>) -> Result<T, String> {
    GIT.with(|slot| match slot.borrow().as_deref() {
        Some(git) => call(git),
        None => Err("no repository is open".to_owned()),
    })
}

/// The export macros: a native host names each plugin's type itself.
#[doc(hidden)]
#[macro_export]
macro_rules! __diffr_native_export {
    ($($tokens:tt)*) => {};
}
