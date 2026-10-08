//! fsharp context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-clause-siblings, collection-shell
#[test]
fn function_clause() {
    // Setup
    let before = r#"module Transport
let send request =
    [
        "alpha"
        "beta"
        "gamma"
        "before"
        previous
        "after"
        "delta"
        "epsilon"
        "zeta"
    ]
"#;
    let after = r#"module Transport
let send request =
    [
        "alpha"
        "beta"
        "gamma"
        "before"
        updated
        "after"
        "delta"
        "epsilon"
        "zeta"
    ]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.fs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.fs → head/example.fs — base → head
 base  head
    1     1   module Transport
    2     2   let send request =
              … base 3–6 / head 3–6 collapsed [fold_state_id=47] …
    7     7           "before"
    8       -         previous
          8 +         updated
    9     9           "after"
              … base 10–13 / head 10–13 collapsed [fold_state_id=49] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn match_sibling_headers() {
    // Setup
    let before = r#"let send value =
    match value with
    | First ->
        dispatch
            alpha
            beta
            gamma
    | Second ->
        dispatch
            alpha
            before
            previous
            after
            zeta
    | Third ->
        dispatch
            alpha
            beta
            gamma
"#;
    let after = r#"let send value =
    match value with
    | First ->
        dispatch
            alpha
            beta
            gamma
    | Second ->
        dispatch
            alpha
            before
            updated
            after
            zeta
    | Third ->
        dispatch
            alpha
            beta
            gamma
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.fs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.fs → head/example.fs — base → head
 base  head
    1     1   let send value =
    2     2       match value with
    3     3       | First ->
              … base 4–7 / head 4–7 collapsed [fold_state_id=6] …
    8     8       | Second ->
    9     9           dispatch
   10    10               alpha
   11    11               before
   12       -             previous
         12 +             updated
   13    13               after
   14    14               zeta
   15    15       | Third ->
              … base 16–19 / head 16–19 collapsed [fold_state_id=14] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings, conditional-path
#[test]
fn direct_conditional_clause_body() {
    // Setup
    let before = r#"let send value =
    match value with
    | First -> if enabled then previous else fallback
    | Second -> other
"#;
    let after = r#"let send value =
    match value with
    | First -> if enabled then updated else fallback
    | Second -> other
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.fs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.fs → head/example.fs — base → head
 base  head
    1     1   let send value =
    2     2       match value with
    3       -     | First -> if enabled then previous else fallback
          3 +     | First -> if enabled then updated else fallback
    4     4       | Second -> other
"#
    );
}
