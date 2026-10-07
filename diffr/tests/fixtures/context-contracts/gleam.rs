//! gleam context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell
#[test]
fn function_body() {
    // Setup
    let before = r#"pub fn send(request) {
  prepare()
  validate()
  record()
  before()
  dispatch(previous)
  after_work()
  trace()
  flush()
  finish()
}
"#;
    let after = r#"pub fn send(request) {
  prepare()
  validate()
  record()
  before()
  dispatch(updated)
  after_work()
  trace()
  flush()
  finish()
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.gleam", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.gleam → head/example.gleam — base → head
 base  head
    1     1   pub fn send(request) {
              … base 2–4 / head 2–4 collapsed [fold_state_id=45] …
    5     5     before()
    6       -   dispatch(previous)
          6 +   dispatch(updated)
    7     7     after_work()
              … base 8–10 / head 8–10 collapsed [fold_state_id=47] …
   11    11   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
