//! Plugin workers: each is a thread holding an instance of every shape
//! plugin. A file goes to the worker with the fewest files in flight and is
//! walked by every plugin there; files on a worker interleave while a plugin
//! awaits I/O. The engine, store state and linker are shared with the
//! [classifier](super::classify).
use super::bindings::{
    self,
    exports::diffr::plugin::api::GuestPlugin,
    types::{self, Attribute, FileEntry, MoveError, RegionIds, RegionView, RowSummary, Side},
    DiffrPlugin, DiffrPluginPre,
};
use super::config::{ComponentSource, Entry};
use super::cursor::Cursor;
use super::MutationFailed;
use crate::pairing::Pairing;
use crate::protocol;
use anyhow::Context as _;
use gix::attrs::StateRef as AttrState;
use gix::bstr::ByteSlice;
use output::Prefixed;
use serde_json::Value;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{mpsc, oneshot, Notify};
use wasmtime::component::{
    Accessor, AccessorTask, Component as Compiled, HasSelf, Linker, Resource, ResourceAny,
    ResourceTable,
};
use wasmtime::{Cache, CacheConfig, Config, Engine, Store};
use wasmtime_wasi::{FsPerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

#[path = "wasm/output.rs"]
mod output;

/// The engine every component compiles with.
pub(super) fn engine() -> anyhow::Result<Engine> {
    let mut config = Config::new();
    config.wasm_component_model(true);
    config.wasm_component_model_async(true);
    // The disk cache is an optimization; read-only homes must still run plugins.
    if let Ok(cache) = Cache::new(CacheConfig::new()) {
        config.cache(Some(cache));
    }
    Ok(Engine::new(&config)?)
}

/// One Store's state, shared by the plugins in it.
pub(super) struct State {
    wasi: WasiCtx,
    http: wasmtime_wasi_http::WasiHttpCtx,
    table: ResourceTable,
    workdir: PathBuf,
    /// The repository `git` reads, opened the first time a plugin asks.
    repo: Option<gix::Repository>,
    /// Its attribute files, read once and queried per path.
    attributes: Option<gix::worktree::Stack>,
}

impl State {
    pub(super) fn new(workdir: &Path) -> anyhow::Result<Self> {
        let mut wasi = WasiCtxBuilder::new();
        wasi.inherit_env()
            .stdout(Prefixed::new("plugins".into()))
            .stderr(Prefixed::new("plugins".into()))
            .inherit_network()
            .allow_ip_name_lookup(true)
            .preopened_dir(workdir, ".", FsPerms::ReadWrite)
            .map_err(anyhow::Error::from)
            .with_context(|| format!("preopening {}", workdir.display()))?;
        Ok(Self {
            wasi: wasi.build(),
            http: wasmtime_wasi_http::WasiHttpCtx::new(),
            table: ResourceTable::new(),
            workdir: workdir.into(),
            repo: None,
            attributes: None,
        })
    }

    /// The repository at the working directory. Opening it fails, and is
    /// reported to the plugin, when the directory is not in one.
    fn repo(&mut self) -> Result<&gix::Repository, String> {
        if self.repo.is_none() {
            let repo = gix::open(&self.workdir)
                .map_err(|error| format!("{}: {error}", self.workdir.display()))?;
            self.repo = Some(repo);
        }
        Ok(self.repo.as_ref().expect("opened above"))
    }
}

impl WasiView for State {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl wasmtime_wasi_http::WasiHttpView for State {
    fn http(&mut self) -> wasmtime_wasi_http::WasiHttpCtxView<'_> {
        wasmtime_wasi_http::WasiHttpCtxView {
            ctx: &mut self.http,
            table: &mut self.table,
            hooks: wasmtime_wasi_http::default_hooks(),
        }
    }
}

impl types::Host for State {}

/// Walk the live tree, calling the plugin on each node before (Pre) and after
/// (Post) its children. False on Pre skips the children and Post; errors stop.
async fn walk(
    accessor: &Accessor<State>,
    plugin: &GuestPlugin<'_>,
    configured: ResourceAny,
    cursor: &Resource<Cursor>,
) -> anyhow::Result<()> {
    let mut after = None;
    while let Some(node) = next_child(accessor, cursor, None, after)? {
        subtree(accessor, plugin, configured, cursor, node).await?;
        after = Some(node);
    }
    Ok(())
}

/// Visit `node` before and after its children.
async fn subtree(
    accessor: &Accessor<State>,
    plugin: &GuestPlugin<'_>,
    configured: ResourceAny,
    cursor: &Resource<Cursor>,
    node: u32,
) -> anyhow::Result<()> {
    let visit = async |phase| -> anyhow::Result<bool> {
        accessor.with(|mut access| -> anyhow::Result<()> {
            access.data_mut().table.get_mut(cursor)?.id = node;
            Ok(())
        })?;
        let borrowed = Resource::new_borrow(cursor.rep());
        plugin
            .call_visit(accessor, configured, borrowed, phase)
            .await?
            .map_err(anyhow::Error::msg)
    };
    if !visit(types::Visit::Pre).await? {
        return Ok(());
    }
    let mut after = None;
    while let Some(child) = next_child(accessor, cursor, Some(node), after)? {
        Box::pin(subtree(accessor, plugin, configured, cursor, child)).await?;
        after = Some(child);
    }
    visit(types::Visit::Post).await?;
    Ok(())
}

fn next_child(
    accessor: &Accessor<State>,
    cursor: &Resource<Cursor>,
    parent: Option<u32>,
    after: Option<u32>,
) -> anyhow::Result<Option<u32>> {
    accessor.with(|mut access| {
        Ok(access
            .data_mut()
            .table
            .get(cursor)?
            .next_child(parent, after)?)
    })
}

impl bindings::diffr::plugin::host::HostCursor for State {
    fn file(&mut self, c: Resource<Cursor>) -> wasmtime::Result<FileEntry> {
        Ok((&self.table.get(&c)?.file).into())
    }
    fn id(&mut self, c: Resource<Cursor>) -> wasmtime::Result<u32> {
        Ok(self.table.get(&c)?.id)
    }
    fn siblings(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<Vec<u32>, MoveError>> {
        Ok(self.table.get(&c)?.siblings(id).map_err(Into::into))
    }
    fn ancestors(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<Vec<types::Region>, MoveError>> {
        Ok(self
            .table
            .get(&c)?
            .ancestors(id)
            .map(|regions| regions.into_iter().map(Into::into).collect())
            .map_err(Into::into))
    }
    fn get(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<RegionView, MoveError>> {
        Ok(self
            .table
            .get(&c)?
            .get(id)
            .map(Into::into)
            .map_err(Into::into))
    }
    fn text(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<String, MoveError>> {
        Ok(self.table.get(&c)?.text(id).map_err(Into::into))
    }
    fn display(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<RowSummary, MoveError>> {
        Ok(self
            .table
            .get(&c)?
            .display(id)
            .map(Into::into)
            .map_err(Into::into))
    }
    fn matching_siblings(
        &mut self,
        c: Resource<Cursor>,
        ids: Vec<u32>,
    ) -> wasmtime::Result<Result<Option<Vec<u32>>, MoveError>> {
        Ok(self
            .table
            .get(&c)?
            .matching_siblings(&ids)
            .map_err(Into::into))
    }
    fn leaves(
        &mut self,
        c: Resource<Cursor>,
        side: Side,
        start: u32,
        end: u32,
    ) -> wasmtime::Result<Vec<u32>> {
        Ok(self.table.get(&c)?.leaves(side.into(), start, end))
    }
    fn has_changes(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<bool, MoveError>> {
        Ok(self.table.get(&c)?.has_changes(id).map_err(Into::into))
    }
    fn paired_leaf(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<Option<u32>, MoveError>> {
        Ok(self.table.get(&c)?.paired_leaf(id).map_err(Into::into))
    }
    fn linked_regions(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<Vec<u32>, MoveError>> {
        Ok(self.table.get(&c)?.linked_regions(id).map_err(Into::into))
    }
    fn is_one_sided(
        &mut self,
        c: Resource<Cursor>,
        id: u32,
    ) -> wasmtime::Result<Result<bool, MoveError>> {
        Ok(self.table.get(&c)?.is_one_sided(id).map_err(Into::into))
    }
    fn source(&mut self, c: Resource<Cursor>, side: Side) -> wasmtime::Result<Option<String>> {
        Ok(self.table.get(&c)?.source(side.into()))
    }
    fn cut(
        &mut self,
        c: Resource<Cursor>,
        region: u32,
        offset: u32,
    ) -> wasmtime::Result<Result<RegionIds, MoveError>> {
        Ok(self
            .table
            .get_mut(&c)?
            .cut(region, offset)
            .map(Into::into)
            .map_err(Into::into))
    }
    fn join(
        &mut self,
        c: Resource<Cursor>,
        regions: Vec<u32>,
    ) -> wasmtime::Result<Result<RegionIds, MoveError>> {
        Ok(self
            .table
            .get_mut(&c)?
            .join(&regions)
            .map(Into::into)
            .map_err(Into::into))
    }
    fn link(
        &mut self,
        c: Resource<Cursor>,
        regions: Vec<u32>,
    ) -> wasmtime::Result<Result<(), MoveError>> {
        Ok(self.table.get_mut(&c)?.link(&regions).map_err(Into::into))
    }
    fn set_collapsed(
        &mut self,
        c: Resource<Cursor>,
        region: u32,
        collapsed: bool,
    ) -> wasmtime::Result<Result<(), MoveError>> {
        Ok(self
            .table
            .get_mut(&c)?
            .set_collapsed(region, collapsed)
            .map_err(Into::into))
    }
    fn set_label(
        &mut self,
        c: Resource<Cursor>,
        region: u32,
        label: Option<String>,
    ) -> wasmtime::Result<Result<(), MoveError>> {
        Ok(self
            .table
            .get_mut(&c)?
            .set_label(region, label)
            .map_err(Into::into))
    }
    fn drop(&mut self, c: Resource<Cursor>) -> wasmtime::Result<()> {
        self.table.delete(c)?;
        Ok(())
    }
}

impl bindings::diffr::plugin::host::Host for State {}

impl bindings::diffr::plugin::git::Host for State {
    fn check_attr(
        &mut self,
        attributes: Vec<String>,
        path: String,
    ) -> wasmtime::Result<Result<Vec<Attribute>, String>> {
        if let Err(error) = self.repo() {
            return Ok(Err(error));
        }
        let repo = self.repo.as_ref().expect("opened above");
        if self.attributes.is_none() {
            let stack = (|| -> anyhow::Result<_> {
                let index = repo.index_or_empty()?;
                Ok(repo
                    .attributes_only(
                        &index,
                        gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
                    )?
                    .detach())
            })();
            match stack {
                Ok(stack) => self.attributes = Some(stack),
                Err(error) => return Ok(Err(format!("{error:#}"))),
            }
        }
        let stack = self.attributes.as_mut().expect("built above");
        Ok(check_attr(repo, stack, &attributes, &path).map_err(|error| format!("{error:#}")))
    }

    fn cat_file(&mut self, object: String) -> wasmtime::Result<Result<Vec<u8>, String>> {
        Ok(self
            .repo()
            .and_then(|repo| cat_file(repo, &object).map_err(|error| format!("{error:#}"))))
    }
}

/// `git check-attr`: each attribute's state for `path`, with git's
/// precedence (info/attributes, .gitattributes files, user, system).
fn check_attr(
    repo: &gix::Repository,
    stack: &mut gix::worktree::Stack,
    attributes: &[String],
    path: &str,
) -> anyhow::Result<Vec<Attribute>> {
    let mut matches = stack.selected_attribute_matches(attributes.iter().map(String::as_str));
    stack
        .at_path(path, None, &repo.objects)?
        .matching_attributes(&mut matches);
    matches
        .iter_selected()
        .map(|matched| {
            Ok(match matched.assignment.state {
                AttrState::Unspecified => Attribute::Unspecified,
                AttrState::Unset => Attribute::Unset,
                AttrState::Set => Attribute::Set,
                AttrState::Value(value) => Attribute::Value(
                    value
                        .as_bstr()
                        .to_str()
                        .with_context(|| format!("{path}: an attribute value is not UTF-8"))?
                        .to_owned(),
                ),
            })
        })
        .collect()
}

/// `git cat-file blob <object>`.
fn cat_file(repo: &gix::Repository, object: &str) -> anyhow::Result<Vec<u8>> {
    let id = gix::ObjectId::from_hex(object.as_bytes())
        .map_err(|error| anyhow::anyhow!("{object:?} is not an object id: {error}"))?;
    Ok(repo.find_blob(id)?.detach().data)
}

/// One enabled shape plugin, compiled and linked once and instantiated by
/// every worker.
struct Component {
    name: Arc<str>,
    reference: String,
    pre: DiffrPluginPre<State>,
    /// JSON for the plugin's constructor.
    options: String,
}

/// Walk one file with every shape plugin in order.
struct Job {
    cursor: Cursor,
    reply: oneshot::Sender<anyhow::Result<Cursor>>,
}

/// A worker's mailbox, and how many files it holds. The mailbox holds one
/// file, so a worker blocked in guest compute leaves it full and dispatch
/// looks elsewhere.
struct WorkerHandle {
    jobs: mpsc::Sender<Job>,
    in_flight: Arc<AtomicUsize>,
}

/// The enabled shape plugins, run by a pool of workers. Each worker holds an
/// instance of every plugin; dropping the pipeline closes the mailboxes and
/// the workers stop once their files are done.
pub(crate) struct Pipeline {
    workers: Vec<WorkerHandle>,
    /// Choosing a worker and counting the file on it is one step.
    dispatch: Mutex<()>,
}

/// The host's imports: WASI, HTTP, and the `git` and `cursor` interfaces.
/// The shape world's imports include everything the classifier's do, so one
/// linker serves both.
pub(super) fn linker(engine: &Engine) -> anyhow::Result<Linker<State>> {
    let mut linker = Linker::<State>::new(engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;
    wasmtime_wasi::p3::add_to_linker(&mut linker)?;
    wasmtime_wasi_http::p3::add_to_linker(&mut linker)?;
    bindings::DiffrPlugin::add_to_linker::<State, HasSelf<State>>(&mut linker, |state| state)?;
    Ok(linker)
}

impl Pipeline {
    /// Compile every enabled shape plugin once, and start `workers` workers.
    /// Returns once every worker has made its instances, so a plugin that
    /// cannot be made fails here.
    pub(crate) fn from_config(
        config: &crate::config::Config,
        workdir: &Path,
        workers: NonZeroUsize,
    ) -> anyhow::Result<Self> {
        let engine = engine()?;
        let linker = linker(&engine)?;
        let plugins = config
            .plugins
            .shape
            .enabled()
            .map(|(name, entry)| {
                compile(&engine, &linker, name, entry)
                    .with_context(|| format!("plugins.shape.{name}"))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let plugins = Arc::new(plugins);
        let mut handles = Vec::with_capacity(workers.get());
        let mut started = Vec::with_capacity(workers.get());
        for _ in 0..workers.get() {
            let (jobs, mailbox) = mpsc::channel(1);
            let in_flight = Arc::new(AtomicUsize::new(0));
            started.push(spawn_worker(
                &engine,
                plugins.clone(),
                workdir,
                mailbox,
                in_flight.clone(),
            )?);
            handles.push(WorkerHandle { jobs, in_flight });
        }
        for made in started {
            made.blocking_recv()
                .context("plugin worker stopped while starting")??;
        }
        Ok(Self {
            workers: handles,
            dispatch: Mutex::new(()),
        })
    }

    /// Run every shape plugin on one file's sides, on the worker with the
    /// fewest files in flight. Returns the edited sides.
    pub(crate) async fn run(
        &self,
        file: &protocol::FileChange,
        sides: Pairing<protocol::Source>,
    ) -> anyhow::Result<Pairing<protocol::Source>> {
        let cursor = match Cursor::new(file.clone(), sides) {
            Ok(cursor) => cursor,
            Err(sides) => return Ok(sides),
        };
        let (reply, result) = oneshot::channel();
        if let Some((job, mailbox)) = self.offer(Job { cursor, reply })? {
            mailbox.send(job).await.map_err(|_| trapped())?;
        }
        let cursor = result.await.map_err(|_| trapped())??;
        Ok(cursor.into_sides())
    }

    /// Give the file to the least-loaded worker whose mailbox has room. When
    /// every mailbox is full, the file is counted on the least-loaded worker
    /// and handed back with that mailbox for the caller to wait on.
    fn offer(&self, job: Job) -> anyhow::Result<Option<(Job, mpsc::Sender<Job>)>> {
        let _choosing = self
            .dispatch
            .lock()
            .expect("choosing a worker does not panic");
        let mut workers: Vec<&WorkerHandle> = self.workers.iter().collect();
        workers.sort_by_key(|worker| worker.in_flight.load(Ordering::SeqCst));
        let mut job = job;
        for worker in &workers {
            match worker.jobs.try_send(job) {
                Ok(()) => {
                    worker.in_flight.fetch_add(1, Ordering::SeqCst);
                    return Ok(None);
                }
                Err(mpsc::error::TrySendError::Full(returned)) => job = returned,
                Err(mpsc::error::TrySendError::Closed(_)) => return Err(trapped()),
            }
        }
        let worker = workers[0];
        worker.in_flight.fetch_add(1, Ordering::SeqCst);
        Ok(Some((job, worker.jobs.clone())))
    }
}

/// A worker dropped a file's reply, or every worker is gone: a plugin
/// trapped. The trap itself is logged to stderr by the worker.
fn trapped() -> anyhow::Error {
    anyhow::anyhow!("a plugin trapped; its error is on stderr")
        .context(MutationFailed("plugin worker".into()))
}

/// Compile a component and link it against the host's imports.
/// Compile a component and link it against the host's imports.
pub(super) fn link(
    engine: &Engine,
    linker: &Linker<State>,
    source: &ComponentSource,
) -> anyhow::Result<wasmtime::component::InstancePre<State>> {
    let started = Instant::now();
    let (component, label) = match source {
        ComponentSource::File(path) => (
            Compiled::from_file(engine, path),
            path.display().to_string(),
        ),
        ComponentSource::Bundled(bytes) => {
            (Compiled::new(engine, bytes), "bundled component".into())
        }
    };
    let component = component
        .map_err(anyhow::Error::from)
        .with_context(|| format!("compiling {label}"))?;
    let pre = linker
        .instantiate_pre(&component)
        .map_err(anyhow::Error::from)
        .with_context(|| format!("linking {label}"))?;
    log::debug!("compiled and linked {label} in {:?}", started.elapsed());
    Ok(pre)
}

fn compile(
    engine: &Engine,
    linker: &Linker<State>,
    name: &str,
    entry: &Entry,
) -> anyhow::Result<Component> {
    let pre = DiffrPluginPre::new(link(engine, linker, &entry.folder().component())?)
        .map_err(anyhow::Error::from)
        .context("not a shape plugin: it must export diffr:plugin/api")?;
    Ok(Component {
        name: entry.folder().name().into(),
        reference: name.to_owned(),
        pre,
        options: Value::Object(entry.options.clone()).to_string(),
    })
}

/// Start a worker thread and report once it has made every plugin, or why
/// it could not.
fn spawn_worker(
    engine: &Engine,
    plugins: Arc<Vec<Component>>,
    workdir: &Path,
    jobs: mpsc::Receiver<Job>,
    in_flight: Arc<AtomicUsize>,
) -> anyhow::Result<oneshot::Receiver<anyhow::Result<()>>> {
    let (ready, made) = oneshot::channel();
    let engine = engine.clone();
    let workdir = workdir.to_owned();
    std::thread::Builder::new()
        .name("diffr-plugins".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = ready.send(Err(error.into()));
                    return;
                }
            };
            runtime.block_on(async {
                match Worker::make(&engine, &plugins, &workdir).await {
                    Ok(worker) => {
                        if ready.send(Ok(())).is_ok() {
                            worker.serve(jobs, in_flight).await;
                        }
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                    }
                }
            });
        })?;
    Ok(made)
}

/// One shape plugin's instance in a worker and its constructed configuration.
struct Instance {
    name: Arc<str>,
    exports: DiffrPlugin,
    configured: ResourceAny,
}

/// One worker's Store and its instance of every shape plugin.
struct Worker {
    store: Store<State>,
    instances: Vec<Instance>,
}

impl Worker {
    /// Instantiate every component and run its constructor.
    async fn make(engine: &Engine, plugins: &[Component], workdir: &Path) -> anyhow::Result<Self> {
        let mut store = Store::new(engine, State::new(workdir)?);
        let mut exports = Vec::new();
        for component in plugins {
            exports.push(component.pre.instantiate_async(&mut store).await?);
        }
        let instances = store
            .run_concurrent(async |accessor| -> anyhow::Result<_> {
                let mut instances = Vec::new();
                for (component, exports) in plugins.iter().zip(exports) {
                    let configured = exports
                        .diffr_plugin_api()
                        .plugin()
                        .call_constructor(accessor, component.options.clone())
                        .await?
                        .map_err(anyhow::Error::msg)
                        .with_context(|| format!("plugins.shape.{}", component.reference))?;
                    instances.push(Instance {
                        name: component.name.clone(),
                        exports,
                        configured,
                    });
                }
                Ok(instances)
            })
            .await??;
        Ok(Self { store, instances })
    }

    /// Run every file sent to this worker, concurrently on the Store's event
    /// loop, until the mailbox closes and the last file is done.
    async fn serve(self, mut jobs: mpsc::Receiver<Job>, in_flight: Arc<AtomicUsize>) {
        let Self {
            mut store,
            instances,
        } = self;
        let instances = Arc::new(instances);
        let done = Arc::new(Notify::new());
        let served = store
            .run_concurrent(async |accessor| -> anyhow::Result<()> {
                while let Some(job) = jobs.recv().await {
                    accessor.spawn(Run {
                        job,
                        instances: instances.clone(),
                        in_flight: in_flight.clone(),
                        done: done.clone(),
                    })?;
                }
                while in_flight.load(Ordering::SeqCst) > 0 {
                    done.notified().await;
                }
                Ok(())
            })
            .await;
        if let Err(error) = served
            .map_err(anyhow::Error::from)
            .and_then(|served| served)
        {
            log::error!("plugin worker: {error:#}");
        }
        for instance in instances.iter() {
            if let Err(error) = instance.configured.resource_drop_async(&mut store).await {
                log::error!(
                    "plugin {}: dropping configuration: {error:#}",
                    instance.name
                );
            }
        }
    }
}

/// One file's run on a worker: a task on the Store's event loop. Its reply
/// carries the result, so the task itself never fails the Store.
struct Run {
    job: Job,
    instances: Arc<Vec<Instance>>,
    in_flight: Arc<AtomicUsize>,
    done: Arc<Notify>,
}

impl AccessorTask<State> for Run {
    async fn run(self, accessor: &Accessor<State>) -> wasmtime::Result<()> {
        let Self {
            job,
            instances,
            in_flight,
            done,
        } = self;
        let _ = job
            .reply
            .send(run_chain(accessor, &instances, job.cursor).await);
        in_flight.fetch_sub(1, Ordering::SeqCst);
        done.notify_one();
        Ok(())
    }
}

/// Walk the file with every plugin in order.
async fn run_chain(
    accessor: &Accessor<State>,
    instances: &[Instance],
    cursor: Cursor,
) -> anyhow::Result<Cursor> {
    let handle = accessor.with(|mut access| access.data_mut().table.push(cursor))?;
    let mut walked = Ok(());
    for instance in instances {
        walked = async {
            accessor.with(|mut access| -> anyhow::Result<()> {
                access.data_mut().table.get_mut(&handle)?.rewind();
                Ok(())
            })?;
            walk(
                accessor,
                &instance.exports.diffr_plugin_api().plugin(),
                instance.configured,
                &handle,
            )
            .await
        }
        .await
        .with_context(|| MutationFailed(instance.name.to_string()));
        if walked.is_err() {
            break;
        }
    }
    let cursor = accessor.with(|mut access| access.data_mut().table.delete(handle))?;
    walked?;
    Ok(cursor)
}
