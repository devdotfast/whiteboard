//! objc context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"void send(
    int first,
    int second
) {
    if (ready) {
        prepare();
        validate();
        record();
        before();
        dispatch(previous);
        after();
        trace();
        flush();
        finish();
    } else {
        recover();
        retry();
        cleanup();
    }
}
"#;
    let after = r#"void send(
    int first,
    int second
) {
    if (ready) {
        prepare();
        validate();
        record();
        before();
        dispatch(updated);
        after();
        trace();
        flush();
        finish();
    } else {
        recover();
        retry();
        cleanup();
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.m", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.m → head/example.m — base → head
 base  head
    1     1   void send(
    2     2       int first,
    3     3       int second
    4     4   ) {
    5     5       if (ready) {
              … base 6–8 / head 6–8 collapsed [fold_state_id=6] …
    9     9           before();
   10       -         dispatch(previous);
         10 +         dispatch(updated);
   11    11           after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=33] …
   15    15       } else {
              … base 16–18 / head 16–18 collapsed [fold_state_id=11] …
   19    19       }
   20    20   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
