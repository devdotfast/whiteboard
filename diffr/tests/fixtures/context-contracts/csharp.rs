//! csharp context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"class Store {
public void Send(
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
}
"#;
    let after = r#"class Store {
public void Send(
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   class Store {
    2     2   public void Send(
    3     3       int first,
    4     4       int second
    5     5   ) {
    6     6       if (ready) {
              … base 7–9 / head 7–9 collapsed [fold_state_id=75] …
   10    10           before();
   11       -         dispatch(previous);
         11 +         dispatch(updated);
   12    12           after();
              … base 13–15 / head 13–15 collapsed [fold_state_id=77] …
   16    16       } else {
              … base 17–19 / head 17–19 collapsed [fold_state_id=79] …
   20    20       }
   21    21   }
   22    22   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: exception-shell, handler-body
#[test]
fn exception_labels_and_folded_handlers() {
    // Setup
    let before = r#"class Store {
void Send() {
  try {
    prepare();
    validate();
    record();
    before();
    dispatch(previous);
    after();
    trace();
    flush();
    finish();
  } catch (Exception error) {
    recover();
    retry();
    cleanup();
  } finally {
    close();
  }
}
}
"#;
    let after = r#"class Store {
void Send() {
  try {
    prepare();
    validate();
    record();
    before();
    dispatch(updated);
    after();
    trace();
    flush();
    finish();
  } catch (Exception error) {
    recover();
    retry();
    cleanup();
  } finally {
    close();
  }
}
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   class Store {
    2     2   void Send() {
    3     3     try {
              … base 4–6 / head 4–6 collapsed [fold_state_id=83] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=85] …
   13    13     } catch (Exception error) {
              … base 14–16 / head 14–16 collapsed [fold_state_id=87] …
   17    17     } finally {
   18    18       close();
   19    19     }
   20    20   }
   21    21   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, documentation, attached-comments, function-shell
#[test]
fn type_and_attached_documentation() {
    // Setup
    let before = r#"/** Transport documentation. */
class Store : Base {
  void Send() {
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
}
"#;
    let after = r#"/** Transport documentation. */
class Store : Base {
  void Send() {
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   class Store : Base {
    3     3     void Send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=57] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=59] …
   13    13     }
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: binding-shell, call-shell
#[test]
fn binding_and_nested_call_arguments() {
    // Setup
    let before = r#"class Store {
void Send() {
  Result response = dispatch(
    alpha,
    beta,
    gamma,
    before,
    previous,
    after,
    delta,
    epsilon,
    zeta
  );
}
}
"#;
    let after = r#"class Store {
void Send() {
  Result response = dispatch(
    alpha,
    beta,
    gamma,
    before,
    updated,
    after,
    delta,
    epsilon,
    zeta
  );
}
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   class Store {
    2     2   void Send() {
    3     3     Result response = dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7       before,
    8       -     previous,
          8 +     updated,
    9     9       after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13     );
   14    14   }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn effective_pragma() {
    // Setup
    let before = r#"#pragma warning disable CS1234
class Store {
  void Send() {
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
}
"#;
    let after = r#"#pragma warning disable CS1234
class Store {
  void Send() {
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   #pragma warning disable CS1234
    2     2   class Store {
    3     3     void Send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=55] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=57] …
   13    13     }
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion, binding-shell, call-shell
#[test]
fn explicit_conversion_or_error_qualifier() {
    // Setup
    let before = r#"class Store {
  void Send() {
    Result response = (Result) dispatch(
      alpha,
      beta,
      gamma,
      before,
      previous,
      after,
      delta,
      epsilon,
      zeta
    );
  }
}
"#;
    let after = r#"class Store {
  void Send() {
    Result response = (Result) dispatch(
      alpha,
      beta,
      gamma,
      before,
      updated,
      after,
      delta,
      epsilon,
      zeta
    );
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
    1     1   class Store {
    2     2     void Send() {
    3     3       Result response = (Result) dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7         before,
    8       -       previous,
          8 +       updated,
    9     9         after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13       );
   14    14     }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, type-shell
#[test]
fn nullable_directive() {
    // Setup
    let before = r#"#nullable enable
/** Transport documentation. */
class Store : Base {
  void Send() {
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
}
"#;
    let after = r#"#nullable enable
/** Transport documentation. */
class Store : Base {
  void Send() {
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
              … base 1–2 / head 1–2 collapsed [fold_state_id=65] …
    3     3   class Store : Base {
    4     4     void Send() {
              … base 5–7 / head 5–7 collapsed [fold_state_id=61] …
    8     8       before();
    9       -     dispatch(previous);
          9 +     dispatch(updated);
   10    10       after();
              … base 11–13 / head 11–13 collapsed [fold_state_id=63] …
   14    14     }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: effective-directives, function-shell
#[test]
fn nullable_across_imports() {
    // Setup
    let before = r#"#nullable enable
using System;
using System.IO;
using System.Collections;
class Store {
  void Send() {
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
}
"#;
    let after = r#"#nullable enable
using System;
using System.IO;
using System.Collections;
class Store {
  void Send() {
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cs → head/example.cs — base → head
 base  head
              … base 1–4 / head 1–4 collapsed [fold_state_id=73] …
    5     5   class Store {
    6     6     void Send() {
              … base 7–9 / head 7–9 collapsed [fold_state_id=69] …
   10    10       before();
   11       -     dispatch(previous);
         11 +     dispatch(updated);
   12    12       after();
              … base 13–15 / head 13–15 collapsed [fold_state_id=71] …
   16    16     }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
