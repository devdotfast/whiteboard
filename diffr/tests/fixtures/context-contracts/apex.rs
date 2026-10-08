//! apex context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"class Store {
void send(
    Integer first,
    Integer second
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
void send(
    Integer first,
    Integer second
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
    let actual = pprint_diff("example.apexc", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.apexc → head/example.apexc — base → head
 base  head
    1     1   class Store {
    2     2   void send(
    3     3       Integer first,
    4     4       Integer second
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
void send() {
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
void send() {
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
    let actual = pprint_diff("example.apexc", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.apexc → head/example.apexc — base → head
 base  head
    1     1   class Store {
    2     2   void send() {
    3     3     try {
              … base 4–6 / head 4–6 collapsed [fold_state_id=81] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=83] …
   13    13     } catch (Exception error) {
              … base 14–16 / head 14–16 collapsed [fold_state_id=85] …
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
class Store extends Base {
  void send() {
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
class Store extends Base {
  void send() {
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
    let actual = pprint_diff("example.apexc", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.apexc → head/example.apexc — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   class Store extends Base {
    3     3     void send() {
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
void send() {
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
void send() {
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
    let actual = pprint_diff("example.apexc", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.apexc → head/example.apexc — base → head
 base  head
    1     1   class Store {
    2     2   void send() {
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

// Contracts: type-assertion
#[test]
fn explicit_conversion_or_error_qualifier() {
    // Setup
    let before = r#"class Store {
void send() {
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
void send() {
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
    let actual = pprint_diff("example.apexc", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.apexc → head/example.apexc — base → head
 base  head
    1     1   class Store {
    2     2   void send() {
    3     3     Result response = (Result) dispatch(
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
