//! newick context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: newick-context
#[test]
fn ancestor_clades() {
    // Setup
    let before = r#"(
  (
    alpha:1,
    beta:2,
    gamma:3,
    before:4,
    previous:5,
    after:6,
    delta:7,
    epsilon:8,
    zeta:9
  )primary:10,
  backup:20
)root:30;
"#;
    let after = r#"(
  (
    alpha:1,
    beta:2,
    gamma:3,
    before:4,
    updated:5,
    after:6,
    delta:7,
    epsilon:8,
    zeta:9
  )primary:10,
  backup:20
)root:30;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.nwk", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.nwk → head/example.nwk — base → head
 base  head
    1     1   (
    2     2     (
              … base 3–5 / head 3–5 collapsed [fold_state_id=19] …
    6     6       before:4,
    7       -     previous:5,
          7 +     updated:5,
    8     8       after:6,
              … base 9–11 / head 9–11 collapsed [fold_state_id=23] …
   12    12     )primary:10,
   13    13     backup:20
   14    14   )root:30;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: newick-context
#[test]
fn multiple_sibling_clades() {
    // Setup
    let before = r#"(
  (
    alpha:1,
    beta:2
  )first:3,
  (
    alpha:1,
    beta:2,
    gamma:3,
    before:4,
    previous:5,
    after:6,
    delta:7,
    epsilon:8,
    zeta:9
  )second:10,
  (
    delta:1,
    epsilon:2
  )third:3
)root:20;
"#;
    let after = r#"(
  (
    alpha:1,
    beta:2
  )first:3,
  (
    alpha:1,
    beta:2,
    gamma:3,
    before:4,
    updated:5,
    after:6,
    delta:7,
    epsilon:8,
    zeta:9
  )second:10,
  (
    delta:1,
    epsilon:2
  )third:3
)root:20;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.nwk", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.nwk → head/example.nwk — base → head
 base  head
    1     1   (
              … base 2–5 / head 2–5 collapsed [fold_state_id=3] …
    6     6     (
              … base 7–9 / head 7–9 collapsed [fold_state_id=27] …
   10    10       before:4,
   11       -     previous:5,
         11 +     updated:5,
   12    12       after:6,
              … base 13–15 / head 13–15 collapsed [fold_state_id=31] …
   16    16     )second:10,
              … base 17–20 / head 17–20 collapsed [fold_state_id=9] …
   21    21   )root:20;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
