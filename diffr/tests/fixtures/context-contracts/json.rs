//! json context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: collection-shell
#[test]
fn nested_collection() {
    // Setup
    let before = r#"{
  "services": {
    "primary": [
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
  }
}
"#;
    let after = r#"{
  "services": {
    "primary": [
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
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.json", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.json → head/example.json — base → head
 base  head
    1     1   {
    2     2     "services": {
    3     3       "primary": [
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7         "before",
    8       -       "previous",
          8 +       "updated",
    9     9         "after",
              … base 10–12 / head 10–12 collapsed [fold_state_id=35] …
   13    13       ]
   14    14     }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
