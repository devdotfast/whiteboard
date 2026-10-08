//! php context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"<?php
function send($first, $second) {
    if ($ready) {
        prepare();
        validate();
        record();
        before();
        dispatch($previous);
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
    let after = r#"<?php
function send($first, $second) {
    if ($ready) {
        prepare();
        validate();
        record();
        before();
        dispatch($updated);
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
    let actual = pprint_diff("example.php", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.php → head/example.php — base → head
 base  head
    1     1   <?php
    2     2   function send($first, $second) {
    3     3       if ($ready) {
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7           before();
    8       -         dispatch($previous);
          8 +         dispatch($updated);
    9     9           after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=35] …
   13    13       } else {
              … base 14–16 / head 14–16 collapsed [fold_state_id=12] …
   17    17       }
   18    18   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn effective_declare_directive() {
    // Setup
    let before = r#"<?php
declare(strict_types=1);
function send() {
    prepare();
    validate();
    record();
    before();
    dispatch($previous);
    after();
    trace();
    flush();
    finish();
}
"#;
    let after = r#"<?php
declare(strict_types=1);
function send() {
    prepare();
    validate();
    record();
    before();
    dispatch($updated);
    after();
    trace();
    flush();
    finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.php", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.php → head/example.php — base → head
 base  head
              … base 1–2 / head 1–2 collapsed [fold_state_id=1] …
    3     3   function send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=5] …
    7     7       before();
    8       -     dispatch($previous);
          8 +     dispatch($updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=21] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn declare_across_imports() {
    // Setup
    let before = r#"<?php
declare(strict_types=1);
use Vendor\Store;
use Vendor\Transport;
use Vendor\Request;
function send() {
    prepare();
    validate();
    record();
    before();
    dispatch(previous);
    after();
    trace();
    flush();
    finish();
}
"#;
    let after = r#"<?php
declare(strict_types=1);
use Vendor\Store;
use Vendor\Transport;
use Vendor\Request;
function send() {
    prepare();
    validate();
    record();
    before();
    dispatch(updated);
    after();
    trace();
    flush();
    finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.php", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.php → head/example.php — base → head
 base  head
              … base 1–5 / head 1–5 collapsed [fold_state_id=1] …
    6     6   function send() {
              … base 7–9 / head 7–9 collapsed [fold_state_id=5] …
   10    10       before();
   11       -     dispatch(previous);
         11 +     dispatch(updated);
   12    12       after();
              … base 13–15 / head 13–15 collapsed [fold_state_id=21] …
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
