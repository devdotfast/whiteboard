//! devicetree context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: build-config-shell
#[test]
fn named_node() {
    // Setup
    let before = r#"/dts-v1/;
/ {
  service {
    routes =
      "alpha",
      "beta",
      "gamma",
      "before",
      "previous",
      "after",
      "delta",
      "epsilon",
      "zeta";
  };
};
"#;
    let after = r#"/dts-v1/;
/ {
  service {
    routes =
      "alpha",
      "beta",
      "gamma",
      "before",
      "updated",
      "after",
      "delta",
      "epsilon",
      "zeta";
  };
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.dts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.dts → head/example.dts — base → head
 base  head
    1     1   /dts-v1/;
    2     2   / {
    3     3     service {
    4     4       routes =
              … base 5–7 / head 5–7 collapsed [fold_state_id=27] …
    8     8         "before",
    9       -       "previous",
          9 +       "updated",
   10    10         "after",
              … base 11–13 / head 11–13 collapsed [fold_state_id=29] …
   14    14     };
   15    15   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
