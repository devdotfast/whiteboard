//! erlang context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-clause-siblings, namespace-shell
#[test]
fn function_clause() {
    // Setup
    let before = r#"-module(transport).
send(Request) ->
    prepare(),
    validate(),
    record(),
    before(),
    dispatch(previous),
    after_work(),
    trace(),
    flush(),
    finish().
"#;
    let after = r#"-module(transport).
send(Request) ->
    prepare(),
    validate(),
    record(),
    before(),
    dispatch(updated),
    after_work(),
    trace(),
    flush(),
    finish().
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.erl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.erl → head/example.erl — base → head
 base  head
    1     1   -module(transport).
    2     2   send(Request) ->
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before(),
    7       -     dispatch(previous),
          7 +     dispatch(updated),
    8     8       after_work(),
              … base 9–10 / head 9–10 collapsed [fold_state_id=23] …
   11    11       finish().

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-clause-siblings, function-shell
#[test]
fn same_function_clause_headers() {
    // Setup
    let before = r#"send(first) ->
    prepare(),
    validate(),
    record(),
    finish();
send(second) when is_atom(second) ->
    prepare(),
    validate(),
    record(),
    before(),
    dispatch(previous),
    after(),
    finish();
send(third) ->
    prepare(),
    validate(),
    record(),
    finish().
"#;
    let after = r#"send(first) ->
    prepare(),
    validate(),
    record(),
    finish();
send(second) when is_atom(second) ->
    prepare(),
    validate(),
    record(),
    before(),
    dispatch(updated),
    after(),
    finish();
send(third) ->
    prepare(),
    validate(),
    record(),
    finish().
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.erl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.erl → head/example.erl — base → head
 base  head
              … base 1–4 / head 1–4 collapsed [fold_state_id=2] …
    5     5       finish();
    6     6   send(second) when is_atom(second) ->
              … base 7–9 / head 7–9 collapsed [fold_state_id=11] …
   10    10       before(),
   11       -     dispatch(previous),
         11 +     dispatch(updated),
   12    12       after(),
   13    13       finish();
              … base 14–17 / head 14–17 collapsed [fold_state_id=16] …
   18    18       finish().

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-clause-siblings
#[test]
fn function_clause_headers() {
    // Setup
    let before = r#"send(first) ->
    prepare(),
    validate(),
    record(),
    finish();
send(second) when is_atom(second) ->
    prepare(),
    validate(),
    dispatch(previous),
    finish();
send(third) ->
    prepare(),
    validate(),
    record(),
    finish().
"#;
    let after = r#"send(first) ->
    prepare(),
    validate(),
    record(),
    finish();
send(second) when is_atom(second) ->
    prepare(),
    validate(),
    dispatch(updated),
    finish();
send(third) ->
    prepare(),
    validate(),
    record(),
    finish().
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.erl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.erl → head/example.erl — base → head
 base  head
              … base 1–4 / head 1–4 collapsed [fold_state_id=2] …
    5     5       finish();
    6     6   send(second) when is_atom(second) ->
    7     7       prepare(),
    8     8       validate(),
    9       -     dispatch(previous),
          9 +     dispatch(updated),
   10    10       finish();
              … base 11–14 / head 11–14 collapsed [fold_state_id=15] …
   15    15       finish().

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn case_sibling_headers() {
    // Setup
    let before = r#"send(Value) ->
    case Value of
        first ->
            prepare(),
            validate(),
            record(),
            finish();
        second ->
            prepare(),
            validate(),
            before(),
            dispatch(previous),
            after(),
            finish();
        third ->
            prepare(),
            validate(),
            record(),
            finish()
    end.
"#;
    let after = r#"send(Value) ->
    case Value of
        first ->
            prepare(),
            validate(),
            record(),
            finish();
        second ->
            prepare(),
            validate(),
            before(),
            dispatch(updated),
            after(),
            finish();
        third ->
            prepare(),
            validate(),
            record(),
            finish()
    end.
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.erl", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.erl → head/example.erl — base → head
 base  head
    1     1   send(Value) ->
    2     2       case Value of
    3     3           first ->
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               finish();
    8     8           second ->
              … base 9–10 / head 9–10 collapsed [fold_state_id=14] …
   11    11               before(),
   12       -             dispatch(previous),
         12 +             dispatch(updated),
   13    13               after(),
   14    14               finish();
   15    15           third ->
              … base 16–19 / head 16–19 collapsed [fold_state_id=20] …
   20    20       end.

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
