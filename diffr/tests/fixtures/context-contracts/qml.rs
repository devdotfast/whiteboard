//! qml context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: qml-context, function-shell
#[test]
fn component_and_binding() {
    // Setup
    let before = r#"Item {
  id: panel
  property string title: "Settings"
  function send(first, second) {
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
    let after = r#"Item {
  id: panel
  property string title: "Settings"
  function send(first, second) {
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
    let actual = pprint_diff("example.qml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.qml → head/example.qml — base → head
 base  head
    1     1   Item {
              … base 2–3 / head 2–3 collapsed [fold_state_id=67] …
    4     4     function send(first, second) {
              … base 5–7 / head 5–7 collapsed [fold_state_id=63] …
    8     8       before();
    9       -     dispatch(previous);
          9 +     dispatch(updated);
   10    10       after();
              … base 11–13 / head 11–13 collapsed [fold_state_id=65] …
   14    14     }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: exception-shell, handler-body
#[test]
fn exception_labels_and_folded_handlers() {
    // Setup
    let before = r#"Item {
function send() {
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
  } catch (error) {
    recover();
    retry();
    cleanup();
  } finally {
    close();
  }
}
}
"#;
    let after = r#"Item {
function send() {
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
  } catch (error) {
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
    let actual = pprint_diff("example.qml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.qml → head/example.qml — base → head
 base  head
    1     1   Item {
    2     2   function send() {
    3     3     try {
              … base 4–6 / head 4–6 collapsed [fold_state_id=85] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=87] …
   13    13     } catch (error) {
              … base 14–16 / head 14–16 collapsed [fold_state_id=89] …
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
Item {
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
}
"#;
    let after = r#"/** Transport documentation. */
Item {
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.qml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.qml → head/example.qml — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   Item {
    3     3     function send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=59] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=61] …
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
    let before = r#"Item {
function send() {
  const response = dispatch(
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
    let after = r#"Item {
function send() {
  const response = dispatch(
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
    let actual = pprint_diff("example.qml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.qml → head/example.qml — base → head
 base  head
    1     1   Item {
    2     2   function send() {
    3     3     const response = dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=9] …
    7     7       before,
    8       -     previous,
          8 +     updated,
    9     9       after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=33] …
   13    13     );
   14    14   }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
