//! ocaml context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lexical-binding-scope, collection-shell
#[test]
fn lexical_binding() {
    // Setup
    let before = r#"let send request =
  let endpoint = "remote" in
  let timeout = 30 in
  [
    "alpha";
    "beta";
    "gamma";
    "before";
    previous;
    "after";
    "delta";
    "epsilon";
    "zeta";
  ]
"#;
    let after = r#"let send request =
  let endpoint = "remote" in
  let timeout = 30 in
  [
    "alpha";
    "beta";
    "gamma";
    "before";
    updated;
    "after";
    "delta";
    "epsilon";
    "zeta";
  ]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ml → head/example.ml — base → head
 base  head
    1     1   let send request =
    2     2     let endpoint = "remote" in
    3     3     let timeout = 30 in
              … base 4–7 / head 4–7 collapsed [fold_state_id=21] …
    8     8       "before";
    9       -     previous;
          9 +     updated;
   10    10       "after";
              … base 11–13 / head 11–13 collapsed [fold_state_id=25] …
   14    14     ]

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
