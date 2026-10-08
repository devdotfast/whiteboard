//! Approved rust context contracts; using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, decorations, documentation, parameter-siblings, attached-comments
#[test]
fn complete_signature_attributes_and_documentation() {
    // Setup
    let before = r#"/// Send a request.
#[inline]
pub async fn send<T: Transport>(
    transport: &T,
    request: Request,
) -> Result<Response, Error>
where
    T::Error: Into<Error>,
{
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
    let after = r#"/// Send a request.
#[inline]
pub async fn send<T: Transport>(
    transport: &T,
    request: Request,
) -> Result<Response, Error>
where
    T::Error: Into<Error>,
{
    prepare();
    validate();
    record();
    before();
    dispatch(next);
    after();
    trace();
    flush();
    finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   /// Send a request.
    2     2   #[inline]
    3     3   pub async fn send<T: Transport>(
    4     4       transport: &T,
    5     5       request: Request,
    6     6   ) -> Result<Response, Error>
    7     7   where
    8     8       T::Error: Into<Error>,
    9     9   {
              … base 10–12 / head 10–12 collapsed [fold_state_id=47] …
   13    13       before();
   14       -     dispatch(previous);
         14 +     dispatch(next);
   15    15       after();
              … base 16–18 / head 16–18 collapsed [fold_state_id=49] …
   19    19   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, conditional-path, loop-shell
#[test]
fn recursive_if_and_loop_context() {
    // Setup
    let before = r#"fn send() {
    if ready {
        for item in items {
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
}
"#;
    let after = r#"fn send() {
    if ready {
        for item in items {
            prepare();
            validate();
            record();
            before();
            dispatch(next);
            after();
            trace();
            flush();
            finish();
        }
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       if ready {
    3     3           for item in items {
              … base 4–6 / head 4–6 collapsed [fold_state_id=59] …
    7     7               before();
    8       -             dispatch(previous);
          8 +             dispatch(next);
    9     9               after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=61] …
   13    13           }
   14    14       }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: conditional-path, conditional-siblings, handler-body
#[test]
fn sibling_conditions_and_short_branch() {
    // Setup
    let before = r#"fn send() {
    if ready {
        prepare();
        validate();
        before();
        dispatch(previous);
        after();
        flush();
        finish();
    } else if fallback {
        recover();
        record();
        retry();
    } else {
        close();
    }
}
"#;
    let after = r#"fn send() {
    if ready {
        prepare();
        validate();
        before();
        dispatch(next);
        after();
        flush();
        finish();
    } else if fallback {
        recover();
        record();
        retry();
    } else {
        close();
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       if ready {
              … base 3–4 / head 3–4 collapsed [fold_state_id=71] …
    5     5           before();
    6       -         dispatch(previous);
          6 +         dispatch(next);
    7     7           after();
              … base 8–9 / head 8–9 collapsed [fold_state_id=73] …
   10    10       } else if fallback {
              … base 11–13 / head 11–13 collapsed [fold_state_id=22] …
   14    14       } else {
   15    15           close();
   16    16       }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: namespace-shell, type-shell, function-shell
#[test]
fn module_impl_and_type_contract() {
    // Setup
    let before = r#"mod transport {
    impl<T: Transport> Store<T> where T::Error: Into<Error> {
        fn send(&self) {
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
}
"#;
    let after = r#"mod transport {
    impl<T: Transport> Store<T> where T::Error: Into<Error> {
        fn send(&self) {
            prepare();
            validate();
            record();
            before();
            dispatch(next);
            after();
            trace();
            flush();
            finish();
        }
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   mod transport {
    2     2       impl<T: Transport> Store<T> where T::Error: Into<Error> {
    3     3           fn send(&self) {
              … base 4–6 / head 4–6 collapsed [fold_state_id=59] …
    7     7               before();
    8       -             dispatch(previous);
          8 +             dispatch(next);
    9     9               after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=61] …
   13    13           }
   14    14       }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn match_patterns_guards_and_sibling_arms() {
    // Setup
    let before = r#"fn send(command: Command) {
    match command {
        Command::Save(item) if item.ready => {
            prepare();
            validate();
            before();
            dispatch(previous);
            after();
            flush();
            finish();
        }
        Command::Retry => {
            recover();
            record();
            retry();
        }
        _ => close(),
    }
}
"#;
    let after = r#"fn send(command: Command) {
    match command {
        Command::Save(item) if item.ready => {
            prepare();
            validate();
            before();
            dispatch(next);
            after();
            flush();
            finish();
        }
        Command::Retry => {
            recover();
            record();
            retry();
        }
        _ => close(),
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send(command: Command) {
    2     2       match command {
    3     3           Command::Save(item) if item.ready => {
              … base 4–5 / head 4–5 collapsed [fold_state_id=77] …
    6     6               before();
    7       -             dispatch(previous);
          7 +             dispatch(next);
    8     8               after();
              … base 9–10 / head 9–10 collapsed [fold_state_id=79] …
   11    11           }
   12    12           Command::Retry => {
              … base 13–15 / head 13–15 collapsed [fold_state_id=26] …
   16    16           }
   17    17           _ => close(),
   18    18       }
   19    19   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: binding-shell, collection-shell
#[test]
fn binding_and_collection_boundaries() {
    // Setup
    let before = r#"const ROUTES: &[&str] = &[
    "alpha",
    "beta",
    "gamma",
    "before",
    "previous",
    "after",
    "delta",
    "epsilon",
    "zeta",
];
"#;
    let after = r#"const ROUTES: &[&str] = &[
    "alpha",
    "beta",
    "gamma",
    "before",
    "next",
    "after",
    "delta",
    "epsilon",
    "zeta",
];
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   const ROUTES: &[&str] = &[
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5       "before",
    6       -     "previous",
          6 +     "next",
    7     7       "after",
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   ];

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: call-shell, binding-shell
#[test]
fn callee_arguments_and_binding_or_return() {
    // Setup
    let before = r#"fn send() {
    let response = dispatch(
        alpha,
        beta,
        gamma,
        before,
        previous,
        after,
        delta,
        epsilon,
        zeta,
    );
}
"#;
    let after = r#"fn send() {
    let response = dispatch(
        alpha,
        beta,
        gamma,
        before,
        next,
        after,
        delta,
        epsilon,
        zeta,
    );
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       let response = dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         next,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       );
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: import-envelope
#[test]
fn multiline_use_path_and_group() {
    // Setup
    let before = r#"use crate::transport::{
    Alpha,
    Beta,
    Gamma,
    Before,
    previous,
    After,
    Delta,
    Epsilon,
    Zeta,
};
"#;
    let after = r#"use crate::transport::{
    Alpha,
    Beta,
    Gamma,
    Before,
    next,
    After,
    Delta,
    Epsilon,
    Zeta,
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   use crate::transport::{
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5       Before,
    6       -     previous,
          6 +     next,
    7     7       After,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: callback-shell, function-shell, call-shell
#[test]
fn callback_signature_and_call_owner() {
    // Setup
    let before = r#"fn send() {
    register(|request: Request| {
        prepare();
        validate();
        record();
        before();
        dispatch(previous);
        after();
        trace();
        flush();
        finish();
    });
}
"#;
    let after = r#"fn send() {
    register(|request: Request| {
        prepare();
        validate();
        record();
        before();
        dispatch(next);
        after();
        trace();
        flush();
        finish();
    });
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       register(|request: Request| {
              … base 3–5 / head 3–5 collapsed [fold_state_id=53] …
    6     6           before();
    7       -         dispatch(previous);
          7 +         dispatch(next);
    8     8           after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=55] …
   12    12       });
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: string-shell, binding-shell
#[test]
fn multiline_string_delimiters_and_interpolation() {
    // Setup
    let before = r##"const TEMPLATE: &str = r#"
alpha
beta
gamma
before
previous
after
delta
epsilon
zeta
"#;
"##;
    let after = r##"const TEMPLATE: &str = r#"
alpha
beta
gamma
before
next
after
delta
epsilon
zeta
"#;
"##;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r##"base/example.rs → head/example.rs — base → head
 base  head
    1     1   const TEMPLATE: &str = r#"
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5   before
    6       - previous
          6 + next
    7     7   after
              … base 8–10 / head 8–10 collapsed [fold_state_id=13] …
   11    11   "#;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"##
    );
}

// Contracts: expression-spine:N, binding-shell
#[test]
fn ordinary_operators_do_not_force_distant_operands_open() {
    // Setup
    let before = r#"fn send() {
    let total = (
        alpha
        + beta
        + gamma
        + before
        + previous
        + after
        + delta
        + epsilon
        + zeta
    );
}
"#;
    let after = r#"fn send() {
    let total = (
        alpha
        + beta
        + gamma
        + before
        + next
        + after
        + delta
        + epsilon
        + zeta
    );
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       let total = (
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           + before
    7       -         + previous
          7 +         + next
    8     8           + after
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       );
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: evaluation-mode, async-qualifiers, error-propagation
#[test]
fn unsafe_async_and_error_propagation() {
    // Setup
    let before = r#"async fn send() -> Result<(), Error> {
    unsafe {
        dispatch(
            alpha,
            beta,
            gamma,
            before,
            previous,
            after,
            delta,
            epsilon,
            zeta,
        ).await?;
    }
    Ok(())
}
"#;
    let after = r#"async fn send() -> Result<(), Error> {
    unsafe {
        dispatch(
            alpha,
            beta,
            gamma,
            before,
            next,
            after,
            delta,
            epsilon,
            zeta,
        ).await?;
    }
    Ok(())
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   async fn send() -> Result<(), Error> {
    2     2       unsafe {
    3     3           dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=9] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=35] …
   13    13           ).await?;
   14    14       }
   15    15       Ok(())
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: evaluation-mode, binding-shell
#[test]
fn const_evaluation_region() {
    // Setup
    let before = r#"const COUNT: usize = const {
    prepare();
    validate();
    record();
    before();
    dispatch(previous);
    after();
    trace();
    flush();
    finish();
    1
};
"#;
    let after = r#"const COUNT: usize = const {
    prepare();
    validate();
    record();
    before();
    dispatch(next);
    after();
    trace();
    flush();
    finish();
    1
};
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   const COUNT: usize = const {
              … base 2–4 / head 2–4 collapsed [fold_state_id=49] …
    5     5       before();
    6       -     dispatch(previous);
          6 +     dispatch(next);
    7     7       after();
              … base 8–11 / head 8–11 collapsed [fold_state_id=51] …
   12    12   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: statement-labels, value-operation, loop-shell
// Labels are approved only when workable using the current query/tagging setup.
#[test]
fn labeled_loop_and_break_value() {
    // Setup
    let before = r#"fn send() {
    'retry: loop {
        break 'retry dispatch(
            alpha,
            beta,
            gamma,
            before,
            previous,
            after,
            delta,
            epsilon,
            zeta,
        );
    }
}
"#;
    let after = r#"fn send() {
    'retry: loop {
        break 'retry dispatch(
            alpha,
            beta,
            gamma,
            before,
            next,
            after,
            delta,
            epsilon,
            zeta,
        );
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       'retry: loop {
    3     3           break 'retry dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13           );
   14    14       }
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: macro-shell
#[test]
fn macro_rule_and_invocation() {
    // Setup
    let before = r#"macro_rules! send {
    ($request:expr) => {
        dispatch(
            alpha,
            beta,
            gamma,
            before,
            previous,
            after,
            delta,
            epsilon,
            zeta,
        )
    };
}
"#;
    let after = r#"macro_rules! send {
    ($request:expr) => {
        dispatch(
            alpha,
            beta,
            gamma,
            before,
            next,
            after,
            delta,
            epsilon,
            zeta,
        )
    };
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   macro_rules! send {
    2     2       ($request:expr) => {
    3     3           dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=29] …
   13    13           )
   14    14       };
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion
#[test]
fn explicit_cast_target() {
    // Setup
    let before = r#"fn send() {
    let result = dispatch(
        alpha,
        beta,
        gamma,
        before,
        previous,
        after,
        delta,
        epsilon,
        zeta,
    ) as u32;
}
"#;
    let after = r#"fn send() {
    let result = dispatch(
        alpha,
        beta,
        gamma,
        before,
        next,
        after,
        delta,
        epsilon,
        zeta,
    ) as u32;
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       let result = dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         next,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       ) as u32;
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: value-operation
#[test]
fn generator_block_marker_and_yield() {
    // Setup
    let before = r#"fn stream() {
    let values = gen {
        yield dispatch(
            alpha,
            beta,
            gamma,
            before,
            previous,
            after,
            delta,
            epsilon,
            zeta,
        );
    };
}
"#;
    let after = r#"fn stream() {
    let values = gen {
        yield dispatch(
            alpha,
            beta,
            gamma,
            before,
            next,
            after,
            delta,
            epsilon,
            zeta,
        );
    };
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn stream() {
    2     2       let values = gen {
    3     3           yield dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13           );
   14    14       };
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, parameter-siblings
#[test]
fn changed_parameter_keeps_sibling_names() {
    // Setup
    let before = r#"fn send(
    alpha: Argument,
    beta: Argument,
    gamma: Argument,
    before: Argument,
    value: previous,
    after: Argument,
    delta: Argument,
    epsilon: Argument,
    zeta: Argument,
) {
    prepare();
    record();
    finish();
}
"#;
    let after = r#"fn send(
    alpha: Argument,
    beta: Argument,
    gamma: Argument,
    before: Argument,
    value: next,
    after: Argument,
    delta: Argument,
    epsilon: Argument,
    zeta: Argument,
) {
    prepare();
    record();
    finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send(
    2     2       alpha: Argument,
    3     3       beta: Argument,
    4     4       gamma: Argument,
    5     5       before: Argument,
    6       -     value: previous,
          6 +     value: next,
    7     7       after: Argument,
    8     8       delta: Argument,
    9     9       epsilon: Argument,
   10    10       zeta: Argument,
   11    11   ) {
              … base 12–14 / head 12–14 collapsed [fold_state_id=27] …
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: collection-shell, binding-shell
#[test]
fn named_collection_key_and_value() {
    // Setup
    let before = r#"fn send() {
    let config = Config {
        alpha: 1,
        beta: 2,
        gamma: 3,
        before: 4,
        value: previous,
        after: 5,
        delta: 6,
        epsilon: 7,
        zeta: 8,
    };
}
"#;
    let after = r#"fn send() {
    let config = Config {
        alpha: 1,
        beta: 2,
        gamma: 3,
        before: 4,
        value: next,
        after: 5,
        delta: 6,
        epsilon: 7,
        zeta: 8,
    };
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       let config = Config {
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before: 4,
    7       -         value: previous,
          7 +         value: next,
    8     8           after: 5,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       };
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, function-shell
#[test]
fn trait_method_header() {
    // Setup
    let before = r#"trait Store {
    fn send(
        &self,
        request: Input,
    ) -> Output {
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
    let after = r#"trait Store {
    fn send(
        &self,
        request: Input,
    ) -> Output {
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
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   trait Store {
    2     2       fn send(
    3     3           &self,
    4     4           request: Input,
    5     5       ) -> Output {
              … base 6–8 / head 6–8 collapsed [fold_state_id=53] …
    9     9           before();
   10       -         dispatch(previous);
         10 +         dispatch(updated);
   11    11           after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=55] …
   15    15       }
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, collection-shell, call-shell
#[test]
fn enum_variant_payload() {
    // Setup
    let before = r#"enum State {
    Idle,
    Ready,
    Active = compute(
        alpha,
        beta,
        gamma,
        before,
        previous,
        after,
        delta,
        epsilon,
        zeta,
    ),
    Done,
}
"#;
    let after = r#"enum State {
    Idle,
    Ready,
    Active = compute(
        alpha,
        beta,
        gamma,
        before,
        updated,
        after,
        delta,
        epsilon,
        zeta,
    ),
    Done,
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   enum State {
              … base 2–3 / head 2–3 collapsed [fold_state_id=41] …
    4     4       Active = compute(
              … base 5–7 / head 5–7 collapsed [fold_state_id=11] …
    8     8           before,
    9       -         previous,
          9 +         updated,
   10    10           after,
              … base 11–13 / head 11–13 collapsed [fold_state_id=39] …
   14    14       ),
   15    15       Done,
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: async-qualifiers, error-propagation, binding-shell
#[test]
fn async_try_qualifiers() {
    // Setup
    let before = r#"fn send() {
    let result = async {
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
        }
    }.await;
}
"#;
    let after = r#"fn send() {
    let result = async {
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
        }
    }.await;
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rs", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rs → head/example.rs — base → head
 base  head
    1     1   fn send() {
    2     2       let result = async {
    3     3           try {
              … base 4–6 / head 4–6 collapsed [fold_state_id=59] …
    7     7               before();
    8       -             dispatch(previous);
          8 +             dispatch(updated);
    9     9               after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=61] …
   13    13           }
   14    14       }.await;
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
