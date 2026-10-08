//! cmake context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: build-config-shell
#[test]
fn named_build_block() {
    // Setup
    let before = r#"function(send request)
  message(alpha)
  message(beta)
  message(gamma)
  message(before)
  message(previous)
  message(after)
  message(delta)
  message(epsilon)
  message(zeta)
endfunction()
"#;
    let after = r#"function(send request)
  message(alpha)
  message(beta)
  message(gamma)
  message(before)
  message(updated)
  message(after)
  message(delta)
  message(epsilon)
  message(zeta)
endfunction()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cmake", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cmake → head/example.cmake — base → head
 base  head
    1     1   function(send request)
              … base 2–4 / head 2–4 collapsed [fold_state_id=45] …
    5     5     message(before)
    6       -   message(previous)
          6 +   message(updated)
    7     7     message(after)
              … base 8–10 / head 8–10 collapsed [fold_state_id=47] …
   11    11   endfunction()

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
