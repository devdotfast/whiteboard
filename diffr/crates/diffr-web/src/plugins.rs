//! The bundled plugins, linked into the engine. No component runtime runs in
//! a browser, so each plugin's own crate is compiled in against the SDK's
//! `native` contract and walks the engine's [`Cursor`] directly. The walk is
//! the native host's: every node before and after its children, every plugin
//! in `plugins.shape.order`.
use anyhow::{anyhow, Context as _};
use diffr_core::pairing::Pairing;
use diffr_core::plugin::config::{ComponentSource, Folder, PluginsConfig};
use diffr_core::plugin::cursor::{self, Cursor};
use diffr_core::plugin::MutationFailed;
use diffr_core::protocol::{self, FileChange, FileStatus, Source};
use diffr_core::tags;
use diffr_plugin_sdk::native::{CursorHost, GitHost};
use diffr_plugin_sdk::prelude::{GuestClassifier, GuestPlugin};
use diffr_plugin_sdk::{FileEntry, MoveError, Region, RegionIds, RegionView, Side, Tag, Visit};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::{pin, Pin};
use std::task::{Context, Poll, Waker};

/// A configured shape plugin, behind one object-safe call.
trait Shape {
    fn visit<'a>(
        &'a self,
        cursor: &'a diffr_plugin_sdk::Cursor,
        phase: Visit,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + 'a>>;
}

impl<T: GuestPlugin> Shape for T {
    fn visit<'a>(
        &'a self,
        cursor: &'a diffr_plugin_sdk::Cursor,
        phase: Visit,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + 'a>> {
        Box::pin(GuestPlugin::visit(self, cursor, phase))
    }
}

fn make<T: GuestPlugin>(options: String) -> Result<Box<dyn Shape>, String> {
    Ok(Box::new(T::new(options)?))
}

type Constructor = fn(String) -> Result<Box<dyn Shape>, String>;

/// The bundled shape plugins this build links, by manifest name.
/// `summarize` calls a model over HTTP and is left to the native diffr.
const LINKED: &[(&str, Constructor)] = &[
    ("context", make::<diffr_plugin_context::Context>),
    (
        "deleted-bodies",
        make::<diffr_plugin_deleted_bodies::DeletedBodies>,
    ),
    (
        "removed-runs",
        make::<diffr_plugin_removed_runs::RemovedRuns>,
    ),
    ("test-bodies", make::<diffr_plugin_test_bodies::TestBodies>),
];

fn is_bundled(folder: &Folder) -> bool {
    matches!(folder.component(), ComponentSource::Bundled(_))
}

/// The enabled shape plugins, made from their configured options, and a
/// notice for each enabled plugin the browser cannot run.
pub(crate) struct Pipeline {
    plugins: Vec<(String, Box<dyn Shape>)>,
}

impl Pipeline {
    pub(crate) fn from_config(
        config: &PluginsConfig,
        notices: &mut Vec<String>,
    ) -> anyhow::Result<Self> {
        let mut plugins = Vec::new();
        for (name, entry) in config.shape.enabled() {
            let folder = entry.folder();
            let linked = LINKED
                .iter()
                .find(|(own, _)| *own == folder.name())
                .filter(|_| is_bundled(folder));
            let Some((_, constructor)) = linked else {
                notices.push(format!(
                    "plugins.shape.{name} is skipped: the browser runs only the bundled plugins {}",
                    LINKED
                        .iter()
                        .map(|(own, _)| *own)
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
                continue;
            };
            let options = Value::Object(entry.options.clone()).to_string();
            let plugin = constructor(options)
                .map_err(|error| anyhow!(error))
                .with_context(|| format!("plugins.shape.{name}"))?;
            plugins.push((folder.name().to_owned(), plugin));
        }
        Ok(Self { plugins })
    }

    /// Walk one file's sides with every plugin in order.
    pub(crate) fn run(
        &self,
        file: &FileChange,
        sides: Pairing<Source>,
    ) -> anyhow::Result<Pairing<Source>> {
        let cursor = match Cursor::new(file.clone(), sides) {
            Ok(cursor) => cursor,
            Err(sides) => return Ok(sides),
        };
        let cursor = diffr_plugin_sdk::Cursor::new(Box::new(Host(cursor)));
        let mut walked = Ok(());
        for (name, plugin) in &self.plugins {
            host(&cursor).0.rewind();
            walked = walk(&cursor, plugin.as_ref()).with_context(|| MutationFailed(name.clone()));
            if walked.is_err() {
                break;
            }
        }
        walked?;
        let host = (cursor.into_host() as Box<dyn std::any::Any>)
            .downcast::<Host>()
            .expect("the cursor's host is the engine's");
        Ok(host.0.into_sides())
    }
}

/// The engine's cursor under the SDK's [`CursorHost`].
struct Host(Cursor);

fn host(cursor: &diffr_plugin_sdk::Cursor) -> std::cell::RefMut<'_, Host> {
    std::cell::RefMut::map(cursor.host_mut(), |host| {
        (host.as_mut() as &mut dyn std::any::Any)
            .downcast_mut::<Host>()
            .expect("the cursor's host is the engine's")
    })
}

/// Walk the live tree, calling the plugin on each node before (Pre) and after
/// (Post) its children. False on Pre skips the children and Post; errors stop.
fn walk(cursor: &diffr_plugin_sdk::Cursor, plugin: &dyn Shape) -> anyhow::Result<()> {
    let mut after = None;
    while let Some(node) = next_child(cursor, None, after)? {
        subtree(cursor, plugin, node)?;
        after = Some(node);
    }
    Ok(())
}

fn subtree(cursor: &diffr_plugin_sdk::Cursor, plugin: &dyn Shape, node: u32) -> anyhow::Result<()> {
    let visit = |phase| -> anyhow::Result<bool> {
        host(cursor).0.id = node;
        ready(plugin.visit(cursor, phase))?.map_err(anyhow::Error::msg)
    };
    if !visit(Visit::Pre)? {
        return Ok(());
    }
    let mut after = None;
    while let Some(child) = next_child(cursor, Some(node), after)? {
        subtree(cursor, plugin, child)?;
        after = Some(child);
    }
    visit(Visit::Post)?;
    Ok(())
}

fn next_child(
    cursor: &diffr_plugin_sdk::Cursor,
    parent: Option<u32>,
    after: Option<u32>,
) -> anyhow::Result<Option<u32>> {
    host(cursor)
        .0
        .next_child(parent, after)
        .map_err(|error| anyhow!(String::from(move_error(error))))
}

/// A linked plugin's visit never waits: nothing it calls does I/O.
pub(crate) fn ready<T>(future: impl Future<Output = T>) -> anyhow::Result<T> {
    match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => Ok(value),
        Poll::Pending => Err(anyhow!("a plugin waited, which the browser cannot do")),
    }
}

/// The bundled classifier, linked in, and what it reads of the repository:
/// blobs the page has fetched. A browser has no `.gitattributes` to read,
/// so every attribute is unspecified.
pub(crate) struct Classifier(diffr_plugin_classify::Classify);

impl Classifier {
    /// `None`, with a notice, for a classifier other than the bundled one.
    pub(crate) fn from_config(
        config: &PluginsConfig,
        notices: &mut Vec<String>,
    ) -> anyhow::Result<Option<Self>> {
        if !is_bundled(config.classify.folder()) {
            notices.push(
                "plugins.classify is skipped: the browser runs only the bundled classifier"
                    .to_owned(),
            );
            return Ok(None);
        }
        let options = Value::Object(config.classify.options.clone()).to_string();
        let classify = <diffr_plugin_classify::Classify as GuestClassifier>::new(options)
            .map_err(|error| anyhow!(error))
            .context("plugins.classify")?;
        Ok(Some(Self(classify)))
    }

    /// Tag `file`, reading the blobs in `blobs` by object id. A blob the
    /// page has not fetched reads as empty, so content rules wait for the
    /// file's diff, which passes its text.
    pub(crate) fn classify(
        &self,
        file: &FileChange,
        blobs: BTreeMap<String, Vec<u8>>,
    ) -> anyhow::Result<(Vec<String>, Option<String>)> {
        let _git = diffr_plugin_sdk::native::set_git(Box::new(Blobs(blobs)));
        let path = match &file.file {
            Pairing::Both { rhs, .. } | Pairing::RightOnly { rhs } => &rhs.path,
            Pairing::LeftOnly { lhs } => &lhs.path,
        };
        let classification = GuestClassifier::classify(&self.0, file_entry(file))
            .map_err(anyhow::Error::msg)
            .with_context(|| format!("classifier: {path}"))?;
        let names = classification
            .tags
            .into_iter()
            .map(|tag| match tag {
                Tag::Generated => Ok(tags::GENERATED.to_owned()),
                Tag::Vendored => Ok("vendored".to_owned()),
                Tag::Docs => Ok("docs".to_owned()),
                Tag::Test => Ok("test".to_owned()),
                Tag::Custom(name) if tags::is_tag(&name) => Ok(name),
                Tag::Custom(name) => Err(anyhow!(
                    "classifier: {path}: {name:?} is not a tag; use lowercase letters, digits, '-' and '_'"
                )),
            })
            .collect::<anyhow::Result<BTreeSet<String>>>()?;
        Ok((names.into_iter().collect(), classification.hidden))
    }
}

struct Blobs(BTreeMap<String, Vec<u8>>);

impl GitHost for Blobs {
    fn check_attr(
        &self,
        attributes: &[String],
        _path: &str,
    ) -> Result<Vec<diffr_plugin_sdk::Attribute>, String> {
        Ok(vec![
            diffr_plugin_sdk::Attribute::Unspecified;
            attributes.len()
        ])
    }

    fn cat_file(&self, object: &str) -> Result<Vec<u8>, String> {
        Ok(self.0.get(object).cloned().unwrap_or_default())
    }
}

impl CursorHost for Host {
    fn file(&self) -> FileEntry {
        file_entry(&self.0.file)
    }
    fn id(&self) -> u32 {
        self.0.id
    }
    fn siblings(&self, id: u32) -> Result<Vec<u32>, MoveError> {
        self.0.siblings(id).map_err(move_error)
    }
    fn ancestors(&self, id: u32) -> Result<Vec<Region>, MoveError> {
        self.0
            .ancestors(id)
            .map(|regions| regions.into_iter().map(region).collect())
            .map_err(move_error)
    }
    fn get(&self, id: u32) -> Result<RegionView, MoveError> {
        self.0.get(id).map(region_view).map_err(move_error)
    }
    fn text(&self, id: u32) -> Result<String, MoveError> {
        self.0.text(id).map_err(move_error)
    }
    fn display(
        &self,
        id: u32,
    ) -> Result<diffr_plugin_sdk::bindings::diffr::plugin::types::RowSummary, MoveError> {
        self.0
            .display(id)
            .map(
                |summary| diffr_plugin_sdk::bindings::diffr::plugin::types::RowSummary {
                    collapsed: summary.collapsed,
                    leading: summary.leading,
                    trailing: summary.trailing,
                    longest_gap: summary.longest_gap,
                },
            )
            .map_err(move_error)
    }
    fn matching_siblings(&self, ids: &[u32]) -> Result<Option<Vec<u32>>, MoveError> {
        self.0.matching_siblings(ids).map_err(move_error)
    }
    fn leaves(&self, side: Side, start: u32, end: u32) -> Vec<u32> {
        self.0.leaves(core_side(side), start, end)
    }
    fn has_changes(&self, id: u32) -> Result<bool, MoveError> {
        self.0.has_changes(id).map_err(move_error)
    }
    fn paired_leaf(&self, id: u32) -> Result<Option<u32>, MoveError> {
        self.0.paired_leaf(id).map_err(move_error)
    }
    fn linked_regions(&self, id: u32) -> Result<Vec<u32>, MoveError> {
        self.0.linked_regions(id).map_err(move_error)
    }
    fn is_one_sided(&self, id: u32) -> Result<bool, MoveError> {
        self.0.is_one_sided(id).map_err(move_error)
    }
    fn source(&self, side: Side) -> Option<String> {
        self.0.source(core_side(side))
    }
    fn cut(&mut self, region: u32, offset: u32) -> Result<RegionIds, MoveError> {
        self.0
            .cut(region, offset)
            .map(region_ids)
            .map_err(move_error)
    }
    fn join(&mut self, regions: &[u32]) -> Result<RegionIds, MoveError> {
        self.0.join(regions).map(region_ids).map_err(move_error)
    }
    fn link(&mut self, regions: &[u32]) -> Result<(), MoveError> {
        self.0.link(regions).map_err(move_error)
    }
    fn set_collapsed(&mut self, region: u32, collapsed: bool) -> Result<(), MoveError> {
        self.0.set_collapsed(region, collapsed).map_err(move_error)
    }
    fn set_label(&mut self, region: u32, label: Option<&str>) -> Result<(), MoveError> {
        self.0
            .set_label(region, label.map(str::to_owned))
            .map_err(move_error)
    }
}

// The engine's types as the contract's records; the native diffr's
// `src/plugin/bindings.rs` does the same for its component host.

fn file_entry(file: &FileChange) -> FileEntry {
    use diffr_plugin_sdk::{FileRef, FileSides, FileStatus as Status};
    let file_ref = |side: &protocol::FileRef| FileRef {
        path: side.path.clone(),
        oid: side.oid.clone(),
        mode: side.mode.clone(),
    };
    FileEntry {
        file: match &file.file {
            Pairing::Both { lhs, rhs } => FileSides::Both((file_ref(lhs), file_ref(rhs))),
            Pairing::LeftOnly { lhs } => FileSides::LeftOnly(file_ref(lhs)),
            Pairing::RightOnly { rhs } => FileSides::RightOnly(file_ref(rhs)),
        },
        status: match file.status {
            FileStatus::Added => Status::Added,
            FileStatus::Deleted => Status::Deleted,
            FileStatus::Modified => Status::Modified,
            FileStatus::Renamed => Status::Renamed,
            FileStatus::Copied => Status::Copied,
            FileStatus::TypeChanged => Status::TypeChanged,
        },
        tags: file.tags.clone(),
    }
}

fn core_side(side: Side) -> cursor::Side {
    match side {
        Side::Lhs => cursor::Side::Lhs,
        Side::Rhs => cursor::Side::Rhs,
    }
}

fn region(view: cursor::RegionView) -> Region {
    use diffr_plugin_sdk::bindings::diffr::plugin::types::{
        Kind, Leaf, Position, Range, Span, Visibility,
    };
    let position = |position: protocol::SourcePos| Position {
        line: position.line,
        column: position.column,
    };
    Region {
        id: view.id,
        parent: view.parent,
        fold_state_id: view.fold_state_id,
        range: Range {
            start: position(view.range.start),
            end: position(view.range.end),
        },
        tags: view.tags,
        visibility: Visibility {
            collapsed: view.visibility.collapsed,
            label: view.visibility.label,
        },
        kind: match view.kind {
            cursor::Kind::Leaf {
                alignment_id,
                changed,
            } => Kind::Leaf(Leaf {
                alignment_id,
                changed: changed
                    .into_iter()
                    .map(|span| Span {
                        line: span.line,
                        start_column: span.start_column,
                        end_column: span.end_column,
                    })
                    .collect(),
            }),
            cursor::Kind::Fold => Kind::Fold,
        },
    }
}

fn region_view(view: cursor::RegionView) -> RegionView {
    RegionView {
        side: match view.side {
            cursor::Side::Lhs => Side::Lhs,
            cursor::Side::Rhs => Side::Rhs,
        },
        children: view.children.clone(),
        data: region(view),
    }
}

fn region_ids(ids: cursor::RegionIds) -> RegionIds {
    match ids {
        cursor::RegionIds::Both(lhs, rhs) => RegionIds::Both((lhs, rhs)),
        cursor::RegionIds::LeftOnly(lhs) => RegionIds::LeftOnly(lhs),
        cursor::RegionIds::RightOnly(rhs) => RegionIds::RightOnly(rhs),
    }
}

fn move_error(error: cursor::MoveError) -> MoveError {
    use diffr_plugin_sdk::bindings::diffr::plugin::types::{CutOutside, Grouping, Repeated};
    let grouping = |grouping: cursor::Grouping| match grouping {
        cursor::Grouping::Link => Grouping::Link,
        cursor::Grouping::Join => Grouping::Join,
    };
    match error {
        cursor::MoveError::NoRegion(id) => MoveError::NoRegion(id),
        cursor::MoveError::CutFold(id) => MoveError::CutFold(id),
        cursor::MoveError::CutOutside { id, offset, len } => {
            MoveError::CutOutside(CutOutside { id, offset, len })
        }
        cursor::MoveError::UnevenSides(id) => MoveError::UnevenSides(id),
        cursor::MoveError::TooFewRegions(g) => MoveError::TooFewRegions(grouping(g)),
        cursor::MoveError::Repeated { grouping: g, ids } => MoveError::Repeated(Repeated {
            grouping: grouping(g),
            ids,
        }),
        cursor::MoveError::OneSided(ids) => MoveError::OneSided(ids),
        cursor::MoveError::NotSiblings(ids) => MoveError::NotSiblings(ids),
        cursor::MoveError::NoNextSibling(id) => MoveError::NoNextSibling(id),
    }
}
