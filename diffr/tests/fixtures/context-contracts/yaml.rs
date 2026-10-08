//! yaml context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: collection-shell
#[test]
fn nested_collection() {
    // Setup
    let before = r#"services:
  primary:
    - alpha
    - beta
    - gamma
    - before
    - previous
    - after
    - delta
    - epsilon
    - zeta
"#;
    let after = r#"services:
  primary:
    - alpha
    - beta
    - gamma
    - before
    - updated
    - after
    - delta
    - epsilon
    - zeta
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.yaml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.yaml → head/example.yaml — base → head
 base  head
    1     1   services:
    2     2     primary:
              … base 3–5 / head 3–5 collapsed [fold_state_id=49] …
    6     6       - before
    7       -     - previous
          7 +     - updated
    8     8       - after
              … base 9–11 / head 9–11 collapsed [fold_state_id=51] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
