//! solidity context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, type-shell
#[test]
fn contract_and_function() {
    // Setup
    let before = r#"contract Transport {
  function send(uint first, uint second) public {
    prepare();
    validate();
    record();
    before();
    dispatch(previous);
    after_work();
    trace();
    flush();
    finish();
  }
}
"#;
    let after = r#"contract Transport {
  function send(uint first, uint second) public {
    prepare();
    validate();
    record();
    before();
    dispatch(updated);
    after_work();
    trace();
    flush();
    finish();
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.sol", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.sol → head/example.sol — base → head
 base  head
    1     1   contract Transport {
    2     2     function send(uint first, uint second) public {
              … base 3–5 / head 3–5 collapsed [fold_state_id=53] …
    6     6       before();
    7       -     dispatch(previous);
          7 +     dispatch(updated);
    8     8       after_work();
              … base 9–11 / head 9–11 collapsed [fold_state_id=55] …
   12    12     }
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion
#[test]
fn explicit_conversion_or_error_qualifier() {
    // Setup
    let before = r#"contract Store {
function send() public {
  Result( dispatch(
    alpha,
    beta,
    gamma,
    before,
    previous,
    after,
    delta,
    epsilon,
    zeta
  ));
}
}
"#;
    let after = r#"contract Store {
function send() public {
  Result( dispatch(
    alpha,
    beta,
    gamma,
    before,
    updated,
    after,
    delta,
    epsilon,
    zeta
  ));
}
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.sol", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.sol → head/example.sol — base → head
 base  head
    1     1   contract Store {
    2     2   function send() public {
    3     3     Result( dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=25] …
    7     7       before,
    8       -     previous,
          8 +     updated,
    9     9       after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=29] …
   13    13     ));
   14    14   }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
