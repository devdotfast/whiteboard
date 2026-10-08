//! haskell context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lexical-binding-scope, function-clause-siblings, collection-shell
#[test]
fn lexical_binding() {
    // Setup
    let before = r#"module Transport where
send request =
  let endpoint = "remote"
      timeout = 30
  in [
    "alpha",
    "beta",
    "gamma",
    "before",
    previous,
    "after",
    "delta",
    "epsilon",
    "zeta"
  ]
"#;
    let after = r#"module Transport where
send request =
  let endpoint = "remote"
      timeout = 30
  in [
    "alpha",
    "beta",
    "gamma",
    "before",
    updated,
    "after",
    "delta",
    "epsilon",
    "zeta"
  ]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.hs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.hs → head/example.hs — base → head
 base  head
    1     1   module Transport where
    2     2   send request =
    3     3     let endpoint = "remote"
    4     4         timeout = 30
    5     5     in [
              … base 6–8 / head 6–8 collapsed [fold_state_id=10] …
    9     9       "before",
   10       -     previous,
         10 +     updated,
   11    11       "after",
              … base 12–14 / head 12–14 collapsed [fold_state_id=37] …
   15    15     ]

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-clause-siblings, function-shell
#[test]
fn same_function_clause_headers() {
    // Setup
    let before = r#"send First =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "zeta"
  ]
send Second =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "before",
    "previous",
    "after",
    "delta",
    "epsilon",
    "zeta"
  ]
send Third =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "zeta"
  ]
"#;
    let after = r#"send First =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "zeta"
  ]
send Second =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "before",
    "updated",
    "after",
    "delta",
    "epsilon",
    "zeta"
  ]
send Third =
  dispatch [
    "alpha",
    "beta",
    "gamma",
    "zeta"
  ]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.hs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.hs → head/example.hs — base → head
 base  head
    1     1   send First =
              … base 2–7 / head 2–7 collapsed [fold_state_id=3] …
    8     8   send Second =
    9     9     dispatch [
              … base 10–12 / head 10–12 collapsed [fold_state_id=15] …
   13    13       "before",
   14       -     "previous",
         14 +     "updated",
   15    15       "after",
              … base 16–18 / head 16–18 collapsed [fold_state_id=65] …
   19    19     ]
   20    20   send Third =
              … base 21–26 / head 21–26 collapsed [fold_state_id=23] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-clause-siblings
#[test]
fn function_clause_headers() {
    // Setup
    let before = r#"send First =
  prepare
    alpha
    beta
    gamma
send Second =
  dispatch
    alpha
    before
    previous
    after
    zeta
send Third =
  prepare
    alpha
    beta
    gamma
"#;
    let after = r#"send First =
  prepare
    alpha
    beta
    gamma
send Second =
  dispatch
    alpha
    before
    updated
    after
    zeta
send Third =
  prepare
    alpha
    beta
    gamma
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.hs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.hs → head/example.hs — base → head
 base  head
    1     1   send First =
              … base 2–5 / head 2–5 collapsed [fold_state_id=3] …
    6     6   send Second =
              … base 7–8 / head 7–8 collapsed [fold_state_id=8] …
    9     9       before
   10       -     previous
         10 +     updated
   11    11       after
   12    12       zeta
   13    13   send Third =
              … base 14–17 / head 14–17 collapsed [fold_state_id=13] …

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
    let actual = pprint_diff("example.hs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.hs → head/example.hs — base → head
 base  head
    1     1   send value =
    2     2       case value of
    3     3           First ->
              … base 4–7 / head 4–7 collapsed [fold_state_id=7] …
    8     8           Second ->
              … base 9–10 / head 9–10 collapsed [fold_state_id=12] …
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
