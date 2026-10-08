//! emacslisp context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: lisp-head-and-quote, lexical-binding-scope
#[test]
fn lexical_form_heads() {
    // Setup
    let before = r#"(defun send (request)
  (let ((endpoint "remote")
        (timeout 30))
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
    let after = r#"(defun send (request)
  (let ((endpoint "remote")
        (timeout 30))
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
    let actual = pprint_diff("example.el", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.el → head/example.el — base → head
 base  head
    1     1   (defun send (request)
    2     2     (let ((endpoint "remote")
    3     3           (timeout 30))
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7       (before)
    8       -     (dispatch previous)
          8 +     (dispatch updated)
    9     9       (after)
              … base 10–12 / head 10–12 collapsed [fold_state_id=25] …
   13    13     ))

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
