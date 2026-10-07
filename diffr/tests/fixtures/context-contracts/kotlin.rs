//! kotlin context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"fun send(
    first: Int,
    second: Int
) {
    if (ready) {
        prepare()
        validate()
        record()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;
    let after = r#"fun send(
    first: Int,
    second: Int
) {
    if (ready) {
        prepare()
        validate()
        record()
        before()
        dispatch(updated)
        after()
        trace()
        flush()
        finish()
    } else {
        recover()
        retry()
        cleanup()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.kt", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.kt → head/example.kt — base → head
 base  head
    1     1   fun send(
    2     2       first: Int,
    3     3       second: Int
    4     4   ) {
    5     5       if (ready) {
              … base 6–8 / head 6–8 collapsed [fold_state_id=69] …
    9     9           before()
   10       -         dispatch(previous)
         10 +         dispatch(updated)
   11    11           after()
              … base 12–14 / head 12–14 collapsed [fold_state_id=71] …
   15    15       } else {
              … base 16–18 / head 16–18 collapsed [fold_state_id=73] …
   19    19       }
   20    20   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: exception-shell, handler-body
#[test]
fn exception_labels_and_folded_handlers() {
    // Setup
    let before = r#"fun send() {
  try {
    prepare()
    validate()
    record()
    before()
    dispatch(previous)
    after()
    trace()
    flush()
    finish()
  } catch (error: Exception) {
    recover()
    retry()
    cleanup()
  } finally {
    close();
  }
}
"#;
    let after = r#"fun send() {
  try {
    prepare()
    validate()
    record()
    before()
    dispatch(updated)
    after()
    trace()
    flush()
    finish()
  } catch (error: Exception) {
    recover()
    retry()
    cleanup()
  } finally {
    close();
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.kt", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.kt → head/example.kt — base → head
 base  head
    1     1   fun send() {
    2     2     try {
              … base 3–5 / head 3–5 collapsed [fold_state_id=77] …
    6     6       before()
    7       -     dispatch(previous)
          7 +     dispatch(updated)
    8     8       after()
              … base 9–11 / head 9–11 collapsed [fold_state_id=79] …
   12    12     } catch (error: Exception) {
              … base 13–15 / head 13–15 collapsed [fold_state_id=81] …
   16    16     } finally {
   17    17       close();
   18    18     }
   19    19   }

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
class Store : Base() {
  fun send() {
    prepare()
    validate()
    record()
    before()
    dispatch(previous)
    after()
    trace()
    flush()
    finish()
  }
}
"#;
    let after = r#"/** Transport documentation. */
class Store : Base() {
  fun send() {
    prepare()
    validate()
    record()
    before()
    dispatch(updated)
    after()
    trace()
    flush()
    finish()
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.kt", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.kt → head/example.kt — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   class Store : Base() {
    3     3     fun send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=57] …
    7     7       before()
    8       -     dispatch(previous)
          8 +     dispatch(updated)
    9     9       after()
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
    let before = r#"fun send() {
  val response = dispatch(
    alpha,
    beta,
    gamma,
    before,
    previous,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;
    let after = r#"fun send() {
  val response = dispatch(
    alpha,
    beta,
    gamma,
    before,
    updated,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.kt", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.kt → head/example.kt — base → head
 base  head
    1     1   fun send() {
    2     2     val response = dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before,
    7       -     previous,
          7 +     updated,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     )
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
    let before = r#"fun send() {
   dispatch(
    alpha,
    beta,
    gamma,
    before,
    previous,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;
    let after = r#"fun send() {
   dispatch(
    alpha,
    beta,
    gamma,
    before,
    updated,
    after,
    delta,
    epsilon,
    zeta
  )
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.kt", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.kt → head/example.kt — base → head
 base  head
    1     1   fun send() {
    2     2      dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before,
    7       -     previous,
          7 +     updated,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     )
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
