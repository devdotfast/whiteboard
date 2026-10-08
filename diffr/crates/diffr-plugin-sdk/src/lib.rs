//! Generated WASM plugin bindings for both kinds of plugin. A shape plugin
//! implements [`GuestPlugin`] and reads and edits the host's trees through the
//! borrowed [`Cursor`]; the classifier implements [`GuestClassifier`]. Both
//! may read the repository through [`git`].
pub mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "diffr-plugin",
        pub_export_macro: true,
        export_macro_name: "export_shape",
        default_bindings_module: "diffr_plugin_sdk::bindings",
        additional_derives: [PartialEq, Eq],
    });
}

/// The classifier's world. Shared records and `git` are the ones above.
pub mod classifier {
    wit_bindgen::generate!({
        path: "wit",
        world: "diffr-classifier",
        pub_export_macro: true,
        export_macro_name: "export_classifier",
        default_bindings_module: "diffr_plugin_sdk::classifier",
        with: {
            "diffr:plugin/types@0.3.0": crate::bindings::diffr::plugin::types,
            "diffr:plugin/git@0.3.0": crate::bindings::diffr::plugin::git,
        },
    });
}

pub mod error;
pub use bindings::diffr::plugin::git;
pub use bindings::diffr::plugin::host::Cursor;
pub use bindings::diffr::plugin::types::{
    Attribute, FileEntry, FileRef, FileSides, FileStatus, Kind, MoveError, Region, RegionIds,
    RegionView, Side, Tag, Visit,
};
pub use bindings::export_shape;
pub use bindings::exports::diffr::plugin::api::{Guest, GuestPlugin};
pub use classifier::export_classifier;
pub use classifier::exports::diffr::plugin::classify::{
    Classification, Guest as ClassifierGuest, GuestClassifier,
};

/// Common imports for either kind of plugin.
pub mod prelude {
    pub use crate::{
        export_classifier, export_shape, git, Attribute, Classification, ClassifierGuest, Cursor,
        FileEntry, FileRef, FileSides, FileStatus, Guest, GuestClassifier, GuestPlugin, Kind,
        Region, RegionIds, RegionView, Side, Tag, Visit,
    };
}
