//! css context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: css-context
#[test]
fn nested_at_rule() {
    // Setup
    let before = r#"@media screen and (min-width: 600px) {
  .panel:hover {
    --alpha: alpha;
    --beta: beta;
    --gamma: gamma;
    --before: before;
    color: previous;
    --after: after;
    --delta: delta;
    --epsilon: epsilon;
    --zeta: zeta;
  }
}
"#;
    let after = r#"@media screen and (min-width: 600px) {
  .panel:hover {
    --alpha: alpha;
    --beta: beta;
    --gamma: gamma;
    --before: before;
    color: updated;
    --after: after;
    --delta: delta;
    --epsilon: epsilon;
    --zeta: zeta;
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.css", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.css → head/example.css — base → head
 base  head
    1     1   @media screen and (min-width: 600px) {
    2     2     .panel:hover {
              … base 3–5 / head 3–5 collapsed [fold_state_id=53] …
    6     6       --before: before;
    7       -     color: previous;
          7 +     color: updated;
    8     8       --after: after;
              … base 9–11 / head 9–11 collapsed [fold_state_id=55] …
   12    12     }
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
