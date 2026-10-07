//! r context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"send <- function(first, second) {
    if (ready) {
        prepare()
        validate()
        record()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;
    let after = r#"send <- function(first, second) {
    if (ready) {
        prepare()
        validate()
        record()
        before()
        dispatch(updated)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.r", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.r → head/example.r — base → head
 base  head
    1     1   send <- function(first, second) {
    2     2       if (ready) {
              … base 3–5 / head 3–5 collapsed [fold_state_id=69] …
    6     6           before()
    7       -         dispatch(previous)
          7 +         dispatch(updated)
    8     8           after()
              … base 9–11 / head 9–11 collapsed [fold_state_id=71] …
   12    12       } else {
              … base 13–15 / head 13–15 collapsed [fold_state_id=73] …
   16    16       }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
