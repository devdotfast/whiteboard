//! Tree-sitter grammars with their largest parse tables stored compressed.
//!
//! Each constant is a grammar constructor, like a grammar crate's `LANGUAGE`.
//! The first call unpacks that grammar's tables.
use std::sync::Once;
use tree_sitter_language::LanguageFn;
// Links libzstd for the grammars' C code.
use zstd_sys as _;

macro_rules! grammar {
    ($name:ident, $unpack:ident, $constructor:ident) => {
        pub const $name: LanguageFn = {
            unsafe extern "C" fn language() -> *const () {
                extern "C" {
                    fn $unpack();
                    fn $constructor() -> *const ();
                }
                static UNPACKED: Once = Once::new();
                // Safety: the unpack function fills this grammar's tables, and
                // `Once` runs it to completion before any caller reads them.
                UNPACKED.call_once(|| unsafe { $unpack() });
                unsafe { $constructor() }
            }
            // Safety: `language` returns the grammar's `TSLanguage` pointer.
            unsafe { LanguageFn::from_raw(language) }
        };
    };
}

include!(concat!(env!("OUT_DIR"), "/grammars.rs"));
