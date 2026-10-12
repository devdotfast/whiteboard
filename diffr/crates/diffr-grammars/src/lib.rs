//! Tree-sitter grammars with their largest parse tables stored compressed.
//!
//! Each constant is a grammar constructor, like a grammar crate's `LANGUAGE`.
//! The first call unpacks that grammar's tables.
use std::sync::Once;
use tree_sitter_language::LanguageFn;
// Links libzstd for the grammars' C code; wasm32 has the pure-Rust decoder below.
#[cfg(not(target_arch = "wasm32"))]
use zstd_sys as _;

/// libzstd's one-shot decompression, which the grammars' unpack functions call, for wasm32,
/// where libzstd does not build. Returns the bytes written, or `usize::MAX` on a bad frame.
///
/// # Safety
///
/// `dst` must be writable for `dst_capacity` bytes and `src` readable for `src_size`.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn ZSTD_decompress(
    dst: *mut u8,
    dst_capacity: usize,
    src: *const u8,
    src_size: usize,
) -> usize {
    // Safety: the caller passes a table's own storage and its packed bytes, with their sizes.
    let (output, input) = unsafe {
        (
            std::slice::from_raw_parts_mut(dst, dst_capacity),
            std::slice::from_raw_parts(src, src_size),
        )
    };
    ruzstd::FrameDecoder::new()
        .decode_all(input, output)
        .unwrap_or(usize::MAX)
}

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
