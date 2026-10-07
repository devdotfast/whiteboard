//! zig context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"fn send(
    first: i32,
    second: i32,
) void {
    if (ready) {
        prepare();
        validate();
        record();
        before();
        dispatch(previous);
        after();
        trace();
        flush();
        finish();
    } else {
        recover();
        retry();
        cleanup();
    }
}
"#;
    let after = r#"fn send(
    first: i32,
    second: i32,
) void {
    if (ready) {
        prepare();
        validate();
        record();
        before();
        dispatch(updated);
        after();
        trace();
        flush();
        finish();
    } else {
        recover();
        retry();
        cleanup();
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.zig", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.zig → head/example.zig — base → head
 base  head
    1     1   fn send(
    2     2       first: i32,
    3     3       second: i32,
    4     4   ) void {
    5     5       if (ready) {
              … base 6–8 / head 6–8 collapsed [fold_state_id=6] …
    9     9           before();
   10       -         dispatch(previous);
         10 +         dispatch(updated);
   11    11           after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=33] …
   15    15       } else {
              … base 16–18 / head 16–18 collapsed [fold_state_id=11] …
   19    19       }
   20    20   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: deferred-cleanup, function-shell
#[test]
fn deferred_cleanup() {
    // Setup
    let before = r#"fn send() void {
    defer close();
    errdefer recover();
    prepare();
    validate();
    record();
    before();
    dispatch(previous);
    after();
    trace();
    flush();
    finish();
}
"#;
    let after = r#"fn send() void {
    defer close();
    errdefer recover();
    prepare();
    validate();
    record();
    before();
    dispatch(updated);
    after();
    trace();
    flush();
    finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.zig", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.zig → head/example.zig — base → head
 base  head
    1     1   fn send() void {
    2     2       defer close();
    3     3       errdefer recover();
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=27] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
