//! hcl context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: build-config-shell, collection-shell, binding-shell
#[test]
fn named_resource() {
    // Setup
    let before = r#"resource "service" "primary" {
  routes = [
    "alpha",
    "beta",
    "gamma",
    "before",
    "previous",
    "after",
    "delta",
    "epsilon",
    "zeta",
  ]
}
"#;
    let after = r#"resource "service" "primary" {
  routes = [
    "alpha",
    "beta",
    "gamma",
    "before",
    "updated",
    "after",
    "delta",
    "epsilon",
    "zeta",
  ]
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tf", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tf → head/example.tf — base → head
 base  head
    1     1   resource "service" "primary" {
    2     2     routes = [
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       "before",
    7       -     "previous",
          7 +     "updated",
    8     8       "after",
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     ]
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
