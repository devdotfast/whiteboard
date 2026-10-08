//! nix context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lexical-binding-scope, collection-shell
#[test]
fn lexical_bindings() {
    // Setup
    let before = r#"let
  endpoint = "remote";
  timeout = 30;
in {
  routes = [
    "alpha"
    "beta"
    "gamma"
    "before"
    "previous"
    "after"
    "delta"
    "epsilon"
    "zeta"
  ];
}
"#;
    let after = r#"let
  endpoint = "remote";
  timeout = 30;
in {
  routes = [
    "alpha"
    "beta"
    "gamma"
    "before"
    "updated"
    "after"
    "delta"
    "epsilon"
    "zeta"
  ];
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.nix", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.nix → head/example.nix — base → head
 base  head
    1     1   let
    2     2     endpoint = "remote";
    3     3     timeout = 30;
    4     4   in {
    5     5     routes = [
              … base 6–8 / head 6–8 collapsed [fold_state_id=63] …
    9     9       "before"
   10       -     "previous"
         10 +     "updated"
   11    11       "after"
              … base 12–14 / head 12–14 collapsed [fold_state_id=65] …
   15    15     ];
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
