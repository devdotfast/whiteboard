//! Approved go context contracts; using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, documentation, parameter-siblings, namespace-shell, attached-comments
#[test]
fn complete_receiver_signature_and_documentation() {
    // Setup
    let before = r#"package transport

// Send a request.
func (client *Client) Send(
    request Request,
    options Options,
) (Response, error) {
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
"#;
    let after = r#"package transport

// Send a request.
func (client *Client) Send(
    request Request,
    options Options,
) (Response, error) {
    prepare()
    validate()
    record()
    before()
    dispatch(next)
    after()
    trace()
    flush()
    finish()
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
              … base 2–3 / head 2–3 collapsed [fold_state_id=3] …
    4     4   func (client *Client) Send(
    5     5       request Request,
    6     6       options Options,
    7     7   ) (Response, error) {
              … base 8–10 / head 8–10 collapsed [fold_state_id=53] …
   11    11       before()
   12       -     dispatch(previous)
         12 +     dispatch(next)
   13    13       after()
              … base 14–16 / head 14–16 collapsed [fold_state_id=55] …
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, conditional-path, loop-shell
#[test]
fn recursive_if_and_loop_context() {
    // Setup
    let before = r#"package transport

func send() {
    if ready {
        for _, item := range items {
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
}
"#;
    let after = r#"package transport

func send() {
    if ready {
        for _, item := range items {
            prepare()
            validate()
            record()
            before()
            dispatch(next)
            after()
            trace()
            flush()
            finish()
        }
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       if ready {
    5     5           for _, item := range items {
              … base 6–8 / head 6–8 collapsed [fold_state_id=65] …
    9     9               before()
   10       -             dispatch(previous)
         10 +             dispatch(next)
   11    11               after()
              … base 12–14 / head 12–14 collapsed [fold_state_id=67] …
   15    15           }
   16    16       }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: conditional-path, conditional-siblings, handler-body
#[test]
fn sibling_conditions_and_short_branch() {
    // Setup
    let before = r#"package transport

func send() {
    if ready {
        prepare()
        validate()
        before()
        dispatch(previous)
        after()
        flush()
        finish()
    } else if fallback {
        recover()
        record()
        retry()
    } else {
        close()
    }
}
"#;
    let after = r#"package transport

func send() {
    if ready {
        prepare()
        validate()
        before()
        dispatch(next)
        after()
        flush()
        finish()
    } else if fallback {
        recover()
        record()
        retry()
    } else {
        close()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       if ready {
              … base 5–6 / head 5–6 collapsed [fold_state_id=75] …
    7     7           before()
    8       -         dispatch(previous)
          8 +         dispatch(next)
    9     9           after()
              … base 10–11 / head 10–11 collapsed [fold_state_id=77] …
   12    12       } else if fallback {
              … base 13–15 / head 13–15 collapsed [fold_state_id=25] …
   16    16       } else {
   17    17           close()
   18    18       }
   19    19   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn select_communication_cases_and_siblings() {
    // Setup
    let before = r#"package transport

func send() {
    select {
    case item := <-input:
        prepare()
        validate()
        before()
        dispatch(previous)
        after()
        flush()
        finish()
    case output <- response:
        record()
        log()
        finish()
    default:
        close()
    }
}
"#;
    let after = r#"package transport

func send() {
    select {
    case item := <-input:
        prepare()
        validate()
        before()
        dispatch(next)
        after()
        flush()
        finish()
    case output <- response:
        record()
        log()
        finish()
    default:
        close()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       select {
    5     5       case item := <-input:
              … base 6–7 / head 6–7 collapsed [fold_state_id=81] …
    8     8           before()
    9       -         dispatch(previous)
          9 +         dispatch(next)
   10    10           after()
              … base 11–12 / head 11–12 collapsed [fold_state_id=83] …
   13    13       case output <- response:
              … base 14–16 / head 14–16 collapsed [fold_state_id=27] …
   17    17       default:
   18    18           close()
   19    19       }
   20    20   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: binding-shell, collection-shell
#[test]
fn binding_and_collection_boundaries() {
    // Setup
    let before = r#"package transport

var routes = []string{
    "alpha",
    "beta",
    "gamma",
    "before",
    "previous",
    "after",
    "delta",
    "epsilon",
    "zeta",
}
"#;
    let after = r#"package transport

var routes = []string{
    "alpha",
    "beta",
    "gamma",
    "before",
    "next",
    "after",
    "delta",
    "epsilon",
    "zeta",
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   var routes = []string{
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7       "before",
    8       -     "previous",
          8 +     "next",
    9     9       "after",
              … base 10–12 / head 10–12 collapsed [fold_state_id=25] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: call-shell, binding-shell
#[test]
fn callee_arguments_and_binding_or_return() {
    // Setup
    let before = r#"package transport

func send() {
    response := dispatch(
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
}
"#;
    let after = r#"package transport

func send() {
    response := dispatch(
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       response := dispatch(
              … base 5–7 / head 5–7 collapsed [fold_state_id=9] …
    8     8           before,
    9       -         previous,
          9 +         next,
   10    10           after,
              … base 11–13 / head 11–13 collapsed [fold_state_id=31] …
   14    14       )
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: import-envelope
#[test]
fn grouped_import_alias_and_module_paths() {
    // Setup
    let before = r#"package transport

import (
    "alpha"
    "beta"
    "gamma"
    "before"
    client "previous"
    "after"
    "delta"
    "epsilon"
    "zeta"
)
"#;
    let after = r#"package transport

import (
    "alpha"
    "beta"
    "gamma"
    "before"
    client "next"
    "after"
    "delta"
    "epsilon"
    "zeta"
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   import (
              … base 4–6 / head 4–6 collapsed [fold_state_id=51] …
    7     7       "before"
    8       -     client "previous"
          8 +     client "next"
    9     9       "after"
              … base 10–12 / head 10–12 collapsed [fold_state_id=53] …
   13    13   )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: callback-shell, function-shell, call-shell
#[test]
fn callback_signature_and_call_owner() {
    // Setup
    let before = r#"package transport

func send() {
    register(func(request Request) {
        prepare()
        validate()
        record()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
        finish()
    })
}
"#;
    let after = r#"package transport

func send() {
    register(func(request Request) {
        prepare()
        validate()
        record()
        before()
        dispatch(next)
        after()
        trace()
        flush()
        finish()
    })
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       register(func(request Request) {
              … base 5–7 / head 5–7 collapsed [fold_state_id=59] …
    8     8           before()
    9       -         dispatch(previous)
          9 +         dispatch(next)
   10    10           after()
              … base 11–13 / head 11–13 collapsed [fold_state_id=61] …
   14    14       })
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: string-shell, binding-shell
#[test]
fn multiline_string_delimiters_and_interpolation() {
    // Setup
    let before = r#"package transport

var template = `
alpha
beta
gamma
before
previous
after
delta
epsilon
zeta
`
"#;
    let after = r#"package transport

var template = `
alpha
beta
gamma
before
next
after
delta
epsilon
zeta
`
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   var template = `
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7   before
    8       - previous
          8 + next
    9     9   after
              … base 10–12 / head 10–12 collapsed [fold_state_id=19] …
   13    13   `

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: expression-spine:N, binding-shell
#[test]
fn ordinary_operators_do_not_force_distant_operands_open() {
    // Setup
    let before = r#"package transport

func send() {
    total := (
        alpha +
        beta +
        gamma +
        before +
        previous +
        after +
        delta +
        epsilon +
        zeta)
}
"#;
    let after = r#"package transport

func send() {
    total := (
        alpha +
        beta +
        gamma +
        before +
        next +
        after +
        delta +
        epsilon +
        zeta)
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       total := (
              … base 5–7 / head 5–7 collapsed [fold_state_id=9] …
    8     8           before +
    9       -         previous +
          9 +         next +
   10    10           after +
              … base 11–12 / head 11–12 collapsed [fold_state_id=31] …
   13    13           zeta)
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: deferred-cleanup, value-operation
#[test]
fn defer_registration_and_go_launch() {
    // Setup
    let before = r#"package transport

func send() {
    defer close()
    prepare()
    validate()
    record()
    go dispatch(
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
}
"#;
    let after = r#"package transport

func send() {
    defer close()
    prepare()
    validate()
    record()
    go dispatch(
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       defer close()
              … base 5–7 / head 5–7 collapsed [fold_state_id=51] …
    8     8       go dispatch(
              … base 9–11 / head 9–11 collapsed [fold_state_id=18] …
   12    12           before,
   13       -         previous,
         13 +         next,
   14    14           after,
              … base 15–17 / head 15–17 collapsed [fold_state_id=49] …
   18    18       )
   19    19   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, binding-shell
#[test]
fn struct_type_and_changed_field() {
    // Setup
    let before = r#"package transport

type Store struct {
    Ready bool
    Pending bool
    Active bool
    Before bool
    Value previous
    After bool
    Closed bool
    Cached bool
    Logged bool
}
"#;
    let after = r#"package transport

type Store struct {
    Ready bool
    Pending bool
    Active bool
    Before bool
    Value next
    After bool
    Closed bool
    Cached bool
    Logged bool
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   type Store struct {
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7       Before bool
    8       -     Value previous
          8 +     Value next
    9     9       After bool
              … base 10–12 / head 10–12 collapsed [fold_state_id=25] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion
// Use syntactic conversions only; do not resolve arbitrary callee names as types.
#[test]
fn explicit_type_conversion() {
    // Setup
    let before = r#"package transport

func send() {
    result := []byte(dispatch(
        alpha,
        beta,
        gamma,
        before,
        previous,
        after,
        delta,
        epsilon,
        zeta,
    ))
}
"#;
    let after = r#"package transport

func send() {
    result := []byte(dispatch(
        alpha,
        beta,
        gamma,
        before,
        next,
        after,
        delta,
        epsilon,
        zeta,
    ))
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       result := []byte(dispatch(
              … base 5–7 / head 5–7 collapsed [fold_state_id=9] …
    8     8           before,
    9       -         previous,
          9 +         next,
   10    10           after,
              … base 11–13 / head 11–13 collapsed [fold_state_id=31] …
   14    14       ))
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: value-operation, call-shell
#[test]
fn channel_send_operation() {
    // Setup
    let before = r#"package transport

func send() {
    output <- dispatch(
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
}
"#;
    let after = r#"package transport

func send() {
    output <- dispatch(
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
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4       output <- dispatch(
              … base 5–7 / head 5–7 collapsed [fold_state_id=9] …
    8     8           before,
    9       -         previous,
          9 +         next,
   10    10           after,
              … base 11–13 / head 11–13 collapsed [fold_state_id=31] …
   14    14       )
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: statement-labels, loop-shell
// Labels are approved only when workable using the current query/tagging setup.
#[test]
fn labeled_loop() {
    // Setup
    let before = r#"package transport

func send() {
retry:
    for ready {
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
    let after = r#"package transport

func send() {
retry:
    for ready {
        prepare()
        validate()
        record()
        before()
        dispatch(next)
        after()
        trace()
        flush()
        finish()
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send() {
    4     4   retry:
    5     5       for ready {
              … base 6–8 / head 6–8 collapsed [fold_state_id=63] …
    9     9           before()
   10       -         dispatch(previous)
         10 +         dispatch(next)
   11    11           after()
              … base 12–14 / head 12–14 collapsed [fold_state_id=65] …
   15    15       }
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, parameter-siblings
#[test]
fn changed_parameter_keeps_sibling_names() {
    // Setup
    let before = r#"package transport

func send(
    alpha Argument,
    beta Argument,
    gamma Argument,
    before Argument,
    value previous,
    after Argument,
    delta Argument,
    epsilon Argument,
    zeta Argument,
) {
    prepare()
    record()
    finish()
}
"#;
    let after = r#"package transport

func send(
    alpha Argument,
    beta Argument,
    gamma Argument,
    before Argument,
    value next,
    after Argument,
    delta Argument,
    epsilon Argument,
    zeta Argument,
) {
    prepare()
    record()
    finish()
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   func send(
    4     4       alpha Argument,
    5     5       beta Argument,
    6     6       gamma Argument,
    7     7       before Argument,
    8       -     value previous,
          8 +     value next,
    9     9       after Argument,
   10    10       delta Argument,
   11    11       epsilon Argument,
   12    12       zeta Argument,
   13    13   ) {
              … base 14–16 / head 14–16 collapsed [fold_state_id=33] …
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: collection-shell, binding-shell
#[test]
fn named_collection_key_and_value() {
    // Setup
    let before = r#"package transport

var config = map[string]any{
    "alpha": 1,
    "beta": 2,
    "gamma": 3,
    "before": 4,
    "value": previous,
    "after": 5,
    "delta": 6,
    "epsilon": 7,
    "zeta": 8,
}
"#;
    let after = r#"package transport

var config = map[string]any{
    "alpha": 1,
    "beta": 2,
    "gamma": 3,
    "before": 4,
    "value": next,
    "after": 5,
    "delta": 6,
    "epsilon": 7,
    "zeta": 8,
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package transport
    2     2
    3     3   var config = map[string]any{
              … base 4–6 / head 4–6 collapsed [fold_state_id=7] …
    7     7       "before": 4,
    8       -     "value": previous,
          8 +     "value": next,
    9     9       "after": 5,
              … base 10–12 / head 10–12 collapsed [fold_state_id=25] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, parameter-siblings
#[test]
fn interface_method_signature() {
    // Setup
    let before = r#"package store

type Store interface {
    Prepare()
    Validate()
    Record()
    Send(
        alpha Input,
        beta Input,
        before Input,
        previous Input,
        after Input,
        zeta Input,
    ) Output
    Flush()
    Finish()
}
"#;
    let after = r#"package store

type Store interface {
    Prepare()
    Validate()
    Record()
    Send(
        alpha Input,
        beta Input,
        before Input,
        updated Input,
        after Input,
        zeta Input,
    ) Output
    Flush()
    Finish()
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package store
    2     2
    3     3   type Store interface {
              … base 4–6 / head 4–6 collapsed [fold_state_id=51] …
    7     7       Send(
    8     8           alpha Input,
    9     9           beta Input,
   10    10           before Input,
   11       -         previous Input,
         11 +         updated Input,
   12    12           after Input,
   13    13           zeta Input,
   14    14       ) Output
              … base 15–16 / head 15–16 collapsed [fold_state_id=53] …
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion, call-shell, binding-shell
#[test]
fn type_assertion_payload() {
    // Setup
    let before = r#"package store

func send() {
    result := compute(
        alpha,
        beta,
        gamma,
        before,
        previous,
        after,
        delta,
        epsilon,
        zeta,
    ).(Result)
}
"#;
    let after = r#"package store

func send() {
    result := compute(
        alpha,
        beta,
        gamma,
        before,
        updated,
        after,
        delta,
        epsilon,
        zeta,
    ).(Result)
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.go", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.go → head/example.go — base → head
 base  head
    1     1   package store
    2     2
    3     3   func send() {
    4     4       result := compute(
              … base 5–7 / head 5–7 collapsed [fold_state_id=9] …
    8     8           before,
    9       -         previous,
          9 +         updated,
   10    10           after,
              … base 11–13 / head 11–13 collapsed [fold_state_id=31] …
   14    14       ).(Result)
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
