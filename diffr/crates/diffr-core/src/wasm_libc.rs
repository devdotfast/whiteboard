//! The C allocator for a `wasm32-unknown-unknown` build, which has no libc:
//! tree-sitter and the grammars' scanners call `malloc` and friends, and
//! these hand them Rust's allocator. Each block keeps its size in a header
//! in front of it, since `free` and `realloc` are not told it.
use std::alloc::{alloc, alloc_zeroed, dealloc, realloc as grow, Layout};

/// The header's size, which is also every block's alignment: the most any
/// C type on wasm32 needs.
const HEADER: usize = 16;

fn layout(size: usize) -> Option<Layout> {
    Layout::from_size_align(size.checked_add(HEADER)?, HEADER).ok()
}

/// Store `size` in the header at `base` and return the block after it.
unsafe fn block(base: *mut u8, size: usize) -> *mut u8 {
    if base.is_null() {
        return base;
    }
    unsafe {
        (base as *mut usize).write(size);
        base.add(HEADER)
    }
}

/// The header in front of `block`, and the size stored in it.
unsafe fn header(block: *mut u8) -> (*mut u8, usize) {
    unsafe {
        let base = block.sub(HEADER);
        (base, (base as *const usize).read())
    }
}

#[no_mangle]
pub unsafe extern "C" fn malloc(size: usize) -> *mut u8 {
    match layout(size) {
        Some(layout) => unsafe { block(alloc(layout), size) },
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn calloc(count: usize, size: usize) -> *mut u8 {
    match count
        .checked_mul(size)
        .and_then(|size| Some((size, layout(size)?)))
    {
        Some((size, layout)) => unsafe { block(alloc_zeroed(layout), size) },
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn realloc(old: *mut u8, size: usize) -> *mut u8 {
    if old.is_null() {
        return unsafe { malloc(size) };
    }
    let Some(new_layout) = layout(size) else {
        return std::ptr::null_mut();
    };
    unsafe {
        let (base, old_size) = header(old);
        let old_layout = layout(old_size).expect("a live block's layout is valid");
        block(grow(base, old_layout, new_layout.size()), size)
    }
}

#[no_mangle]
pub unsafe extern "C" fn free(block: *mut u8) {
    if block.is_null() {
        return;
    }
    unsafe {
        let (base, size) = header(block);
        dealloc(base, layout(size).expect("a live block's layout is valid"));
    }
}
