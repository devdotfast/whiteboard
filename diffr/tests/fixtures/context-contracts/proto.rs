//! proto context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: proto-group-context
#[test]
fn message_and_oneof() {
    // Setup
    let before = r#"syntax = "proto3";
message Transport {
  oneof payload {
    string alpha = 1;
    string beta = 2;
    string gamma = 3;
    string before = 4;
    previous value = 5;
    string after = 6;
    string delta = 7;
    string epsilon = 8;
    string zeta = 9;
  }
}
"#;
    let after = r#"syntax = "proto3";
message Transport {
  oneof payload {
    string alpha = 1;
    string beta = 2;
    string gamma = 3;
    string before = 4;
    updated value = 5;
    string after = 6;
    string delta = 7;
    string epsilon = 8;
    string zeta = 9;
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.proto", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.proto → head/example.proto — base → head
 base  head
    1     1   syntax = "proto3";
    2     2   message Transport {
    3     3     oneof payload {
              … base 4–6 / head 4–6 collapsed [fold_state_id=21] …
    7     7       string before = 4;
    8       -     previous value = 5;
          8 +     updated value = 5;
    9     9       string after = 6;
              … base 10–12 / head 10–12 collapsed [fold_state_id=25] …
   13    13     }
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
