//! cplusplus context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"void send(
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
"#;
    let after = r#"void send(
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   void send(
    2     2       int first,
    3     3       int second
    4     4   ) {
    5     5       if (ready) {
              … base 6–8 / head 6–8 collapsed [fold_state_id=71] …
    9     9           before();
   10       -         dispatch(previous);
         10 +         dispatch(updated);
   11    11           after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=73] …
   15    15       } else {
              … base 16–18 / head 16–18 collapsed [fold_state_id=26] …
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
    let before = r#"void send() {
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
  } catch (Error error) {
    recover();
    retry();
    cleanup();
  }
}
"#;
    let after = r#"void send() {
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
  } catch (Error error) {
    recover();
    retry();
    cleanup();
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   void send() {
    2     2     try {
              … base 3–5 / head 3–5 collapsed [fold_state_id=71] …
    6     6       before();
    7       -     dispatch(previous);
          7 +     dispatch(updated);
    8     8       after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=73] …
   12    12     } catch (Error error) {
              … base 13–15 / head 13–15 collapsed [fold_state_id=26] …
   16    16     }
   17    17   }

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
class Store : public Base {
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
};
"#;
    let after = r#"/** Transport documentation. */
class Store : public Base {
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
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   class Store : public Base {
    3     3     void send() {
              … base 4–6 / head 4–6 collapsed [fold_state_id=57] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(updated);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=59] …
   13    13     }
   14    14   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: binding-shell, call-shell
#[test]
fn binding_and_nested_call_arguments() {
    // Setup
    let before = r#"void send() {
  auto response = dispatch(
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
"#;
    let after = r#"void send() {
  auto response = dispatch(
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   void send() {
    2     2     auto response = dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before,
    7       -     previous,
          7 +     updated,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     );
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: access-section, function-shell
#[test]
fn effective_access_section() {
    // Setup
    let before = r#"class Store {
private:
  void unrelated() { work(); }
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
public:
  void other() { work(); }
};
"#;
    let after = r#"class Store {
private:
  void unrelated() { work(); }
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
public:
  void other() { work(); }
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   class Store {
              … base 2–3 / head 2–3 collapsed [fold_state_id=75] …
    4     4     void send() {
              … base 5–7 / head 5–7 collapsed [fold_state_id=71] …
    8     8       before();
    9       -     dispatch(previous);
          9 +     dispatch(updated);
   10    10       after();
              … base 11–13 / head 11–13 collapsed [fold_state_id=73] …
   14    14     }
              … base 15–16 / head 15–16 collapsed [fold_state_id=77] …
   17    17   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion
#[test]
fn explicit_conversion_or_error_qualifier() {
    // Setup
    let before = r#"void send() {
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
"#;
    let after = r#"void send() {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   void send() {
    2     2     Result response = (Result) dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before,
    7       -     previous,
          7 +     updated,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     );
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: constructor-initializers, function-shell
#[test]
fn constructor_initializers() {
    // Setup
    let before = r#"class Store {
  Store(int first, int second)
    : first_(first),
      second_(second) {
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
};
"#;
    let after = r#"class Store {
  Store(int first, int second)
    : first_(first),
      second_(second) {
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
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   class Store {
    2     2     Store(int first, int second)
    3     3       : first_(first),
    4     4         second_(second) {
              … base 5–7 / head 5–7 collapsed [fold_state_id=59] …
    8     8       before();
    9       -     dispatch(previous);
          9 +     dispatch(updated);
   10    10       after();
              … base 11–13 / head 11–13 collapsed [fold_state_id=61] …
   14    14     }
   15    15   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: access-section, function-shell
#[test]
fn access_section_reset() {
    // Setup
    let before = r#"class Store {
private:
  void private_member() {
    prepare();
    validate();
    record();
  }
public:
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
};
"#;
    let after = r#"class Store {
private:
  void private_member() {
    prepare();
    validate();
    record();
  }
public:
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
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.cpp", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.cpp → head/example.cpp — base → head
 base  head
    1     1   class Store {
              … base 2–8 / head 2–8 collapsed [fold_state_id=87] …
    9     9     void send() {
              … base 10–12 / head 10–12 collapsed [fold_state_id=83] …
   13    13       before();
   14       -     dispatch(previous);
         14 +     dispatch(updated);
   15    15       after();
              … base 16–18 / head 16–18 collapsed [fold_state_id=85] …
   19    19     }
   20    20   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
