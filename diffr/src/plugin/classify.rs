//! The classifier: one component in its own Store, asked about every
//! changed file before any is diffed.
use super::bindings::classifier::{DiffrClassifier, DiffrClassifierPre};
use super::bindings::types::{self, FileEntry, Tag};
use super::wasm::{engine, link, linker, State};
use crate::protocol;
use anyhow::Context as _;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;
use wasmtime::component::{Accessor, ResourceAny};
use wasmtime::Store;

/// A configured classifier, ready to be asked about files.
pub(crate) struct Classifier {
    runtime: tokio::runtime::Runtime,
    store: Store<State>,
    exports: DiffrClassifier,
    configured: ResourceAny,
}

impl Classifier {
    /// Compile the configured classifier, instantiate it and run its
    /// constructor. `git` reads resolve against `workdir`.
    pub(crate) fn from_config(
        config: &crate::config::Config,
        workdir: &Path,
    ) -> anyhow::Result<Self> {
        let engine = engine()?;
        let linker = linker(&engine)?;
        let pre = DiffrClassifierPre::new(link(
            &engine,
            &linker,
            &config.plugins.classify.folder().component(),
        )?)
        .map_err(anyhow::Error::from)
        .context("not a classifier: it must export diffr:plugin/classify")
        .context("classifier")?;
        let options = Value::Object(config.plugins.classify.options.clone()).to_string();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let mut store = Store::new(&engine, State::new(workdir)?);
        let (exports, configured) = runtime.block_on(async {
            let exports = pre.instantiate_async(&mut store).await?;
            let configured = store
                .run_concurrent(async |accessor| -> anyhow::Result<ResourceAny> {
                    exports
                        .diffr_plugin_classify()
                        .classifier()
                        .call_constructor(accessor, options.clone())
                        .await?
                        .map_err(anyhow::Error::msg)
                })
                .await?
                .context("classifier")?;
            anyhow::Ok((exports, configured))
        })?;
        Ok(Self {
            runtime,
            store,
            exports,
            configured,
        })
    }

    /// The classifier's verdict on each file, in order.
    pub(crate) fn classify(
        &mut self,
        files: &[protocol::FileChange],
    ) -> anyhow::Result<Vec<Classified>> {
        let Self {
            runtime,
            store,
            exports,
            configured,
        } = self;
        runtime.block_on(store.run_concurrent(async |accessor| {
            let mut classified = Vec::with_capacity(files.len());
            for file in files {
                classified.push(classify(accessor, exports, *configured, file.into()).await?);
            }
            Ok(classified)
        }))?
    }
}

impl Drop for Classifier {
    fn drop(&mut self) {
        if let Err(error) = self
            .runtime
            .block_on(self.configured.resource_drop_async(&mut self.store))
        {
            log::error!("classifier: dropping configuration: {error:#}");
        }
    }
}

/// What the classifier decided about one file.
pub(crate) struct Classified {
    /// Tag names, sorted and deduplicated.
    pub(crate) tags: Vec<String>,
    /// Hide the file behind this reason.
    pub(crate) hidden: Option<String>,
}

/// The classifier's verdict on a file, its tags as names.
async fn classify(
    accessor: &Accessor<State>,
    exports: &DiffrClassifier,
    configured: ResourceAny,
    file: FileEntry,
) -> anyhow::Result<Classified> {
    let path = match &file.file {
        types::FileSides::Both((_, rhs)) | types::FileSides::RightOnly(rhs) => rhs.path.clone(),
        types::FileSides::LeftOnly(lhs) => lhs.path.clone(),
    };
    let classification = exports
        .diffr_plugin_classify()
        .classifier()
        .call_classify(accessor, configured, file)
        .await?
        .map_err(anyhow::Error::msg)
        .with_context(|| format!("classifier: {path}"))?;
    let names = classification
        .tags
        .into_iter()
        .map(|tag| match tag {
            Tag::Generated => Ok(crate::tags::GENERATED.to_owned()),
            Tag::Vendored => Ok("vendored".to_owned()),
            Tag::Docs => Ok("docs".to_owned()),
            Tag::Test => Ok("test".to_owned()),
            Tag::Custom(name) if crate::tags::is_tag(&name) => Ok(name),
            Tag::Custom(name) => Err(anyhow::anyhow!(
                "classifier: {path}: {name:?} is not a tag; use lowercase letters, digits, '-' and '_'"
            )),
        })
        .collect::<anyhow::Result<BTreeSet<String>>>()?;
    Ok(Classified {
        tags: names.into_iter().collect(),
        hidden: classification.hidden,
    })
}
