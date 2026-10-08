//! janet context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lisp-head-and-quote, lexical-binding-scope
#[test]
fn lexical_form_heads() {
    // Setup
    let before = r#"(defn send [request]
  (do
    (alpha)
    (beta)
    (gamma)
    (before)
    (dispatch previous)
    (after)
    (delta)
    (epsilon)
    (zeta)
  ))
"#;
    let after = r#"(defn send [request]
  (do
    (alpha)
    (beta)
    (gamma)
    (before)
    (dispatch updated)
    (after)
    (delta)
    (epsilon)
    (zeta)
  ))
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.janet", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.janet → head/example.janet — base → head
 base  head
    1     1   (defn send [request]
    2     2     (do
              … base 3–5 / head 3–5 collapsed [fold_state_id=5] …
    6     6       (before)
    7       -     (dispatch previous)
          7 +     (dispatch updated)
    8     8       (after)
              … base 9–11 / head 9–11 collapsed [fold_state_id=21] …
   12    12     ))

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
