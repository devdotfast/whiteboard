//! elm context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lexical-binding-scope, namespace-shell, collection-shell
#[test]
fn lexical_binding() {
    // Setup
    let before = r#"module Transport exposing (send)

send request =
    let
        endpoint = "remote"
        timeout = 30
    in
    [
      "alpha"
    , "beta"
    , "gamma"
    , "before"
    , previous
    , "after"
    , "delta"
    , "epsilon"
    , "zeta"
    ]
"#;
    let after = r#"module Transport exposing (send)

send request =
    let
        endpoint = "remote"
        timeout = 30
    in
    [
      "alpha"
    , "beta"
    , "gamma"
    , "before"
    , updated
    , "after"
    , "delta"
    , "epsilon"
    , "zeta"
    ]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.elm", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.elm → head/example.elm — base → head
 base  head
              … base 1–2 / head 1–2 collapsed [fold_state_id=41] …
    3     3   send request =
    4     4       let
    5     5           endpoint = "remote"
    6     6           timeout = 30
    7     7       in
    8     8       [
              … base 9–11 / head 9–11 collapsed [fold_state_id=14] …
   12    12       , "before"
   13       -     , previous
         13 +     , updated
   14    14       , "after"
              … base 15–17 / head 15–17 collapsed [fold_state_id=39] …
   18    18       ]

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn case_sibling_headers() {
    // Setup
    let before = r#"send value =
    case value of
        First ->
            dispatch
                alpha
                beta
                gamma
        Second ->
            dispatch
                alpha
                before
                previous
                after
                zeta
        Third ->
            dispatch
                alpha
                beta
                gamma
"#;
    let after = r#"send value =
    case value of
        First ->
            dispatch
                alpha
                beta
                gamma
        Second ->
            dispatch
                alpha
                before
                updated
                after
                zeta
        Third ->
            dispatch
                alpha
                beta
                gamma
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.elm", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.elm → head/example.elm — base → head
 base  head
    1     1   send value =
    2     2       case value of
    3     3           First ->
              … base 4–7 / head 4–7 collapsed [fold_state_id=7] …
    8     8           Second ->
    9     9               dispatch
   10    10                   alpha
   11    11                   before
   12       -                 previous
         12 +                 updated
   13    13                   after
   14    14                   zeta
   15    15           Third ->
              … base 16–19 / head 16–19 collapsed [fold_state_id=17] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
