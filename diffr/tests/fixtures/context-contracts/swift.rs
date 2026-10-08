//! swift context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"func send(
    first: Int,
    second: Int
) {
    if ready {
        prepare()
        validate()
        record()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;
    let after = r#"func send(
    first: Int,
    second: Int
) {
    if ready {
        prepare()
        validate()
        record()
        before()
        dispatch(updated)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.swift", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.swift → head/example.swift — base → head
 base  head
    1     1   func send(
    2     2       first: Int,
    3     3       second: Int
    4     4   ) {
    5     5       if ready {
              … base 6–8 / head 6–8 collapsed [fold_state_id=69] …
    9     9           before()
   10       -         dispatch(previous)
         10 +         dispatch(updated)
   11    11           after()
              … base 12–14 / head 12–14 collapsed [fold_state_id=71] …
   15    15       } else {
              … base 16–18 / head 16–18 collapsed [fold_state_id=25] …
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
    let before = r#"func send() {
    defer { close() }
    prepare()
    validate()
    record()
    before()
    dispatch(previous)
    after()
    trace()
    flush()
    finish()
}
"#;
    let after = r#"func send() {
    defer { close() }
    prepare()
    validate()
    record()
    before()
    dispatch(updated)
    after()
    trace()
    flush()
    finish()
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.swift", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.swift → head/example.swift — base → head
 base  head
    1     1   func send() {
    2     2       defer { close() }
              … base 3–5 / head 3–5 collapsed [fold_state_id=51] …
    6     6       before()
    7       -     dispatch(previous)
          7 +     dispatch(updated)
    8     8       after()
              … base 9–11 / head 9–11 collapsed [fold_state_id=53] …
   12    12   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: error-propagation, async-qualifiers
#[test]
fn explicit_conversion_or_error_qualifier() {
    // Setup
    let before = r#"func send() {
  try await dispatch(
    alpha,
    beta,
    gamma,
    before,
    previous,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;
    let after = r#"func send() {
  try await dispatch(
    alpha,
    beta,
    gamma,
    before,
    updated,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.swift", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.swift → head/example.swift — base → head
 base  head
    1     1   func send() {
    2     2     try await dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=19] …
    6     6       before,
    7       -     previous,
          7 +     updated,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=23] …
   12    12     )
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
