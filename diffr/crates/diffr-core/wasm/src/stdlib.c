/* The allocator is Rust's (diffr-core's wasm_libc.rs); abort traps. Weak,
 * since grammars may compile this file too. */
#include <stdlib.h>

__attribute__((weak, noreturn)) void abort(void) { __builtin_trap(); }
