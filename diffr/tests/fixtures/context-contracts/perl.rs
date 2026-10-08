//! perl context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"sub send {
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
    let after = r#"sub send {
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
    let actual = pprint_diff("example.pl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.pl → head/example.pl — base → head
 base  head
    1     1   sub send {
    2     2       if ($ready) {
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before();
    7       -         dispatch($previous);
          7 +         dispatch($updated);
    8     8           after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=33] …
   12    12       } else {
              … base 13–15 / head 13–15 collapsed [fold_state_id=11] …
   16    16       }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn effective_use_directive() {
    // Setup
    let before = r#"use strict;
sub send {
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
    let after = r#"use strict;
sub send {
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
    let actual = pprint_diff("example.pl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.pl → head/example.pl — base → head
 base  head
    1     1   use strict;
    2     2   sub send {
              … base 3–5 / head 3–5 collapsed [fold_state_id=5] …
    6     6       before();
    7       -     dispatch($previous);
          7 +     dispatch($updated);
    8     8       after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=21] …
   12    12   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn strictness_modes_across_imports() {
    // Setup
    let before = r#"use strict;
use warnings;
use feature 'say';
use Foo;
use Bar;
use Baz;
sub send {
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
    let after = r#"use strict;
use warnings;
use feature 'say';
use Foo;
use Bar;
use Baz;
sub send {
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
    let actual = pprint_diff("example.pl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.pl → head/example.pl — base → head
 base  head
              … base 1–6 / head 1–6 collapsed [fold_state_id=1] …
    7     7   sub send {
              … base 8–10 / head 8–10 collapsed [fold_state_id=5] …
   11    11       before();
   12       -     dispatch(previous);
         12 +     dispatch(updated);
   13    13       after();
              … base 14–16 / head 14–16 collapsed [fold_state_id=21] …
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn version_mode_across_imports() {
    // Setup
    let before = r#"use v5.36;
use Foo;
use Bar;
use Baz;
sub send {
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
    let after = r#"use v5.36;
use Foo;
use Bar;
use Baz;
sub send {
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
    let actual = pprint_diff("example.pl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.pl → head/example.pl — base → head
 base  head
              … base 1–4 / head 1–4 collapsed [fold_state_id=1] …
    5     5   sub send {
              … base 6–8 / head 6–8 collapsed [fold_state_id=5] …
    9     9       before();
   10       -     dispatch(previous);
         10 +     dispatch(updated);
   11    11       after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=21] …
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
