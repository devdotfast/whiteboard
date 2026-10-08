//! Approved python context contracts; using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, decorations, documentation, parameter-siblings, attached-comments
#[test]
fn complete_signature_decorators_and_docstring() {
    // Setup
    let before = r#"# Request entrypoint.
@retry(attempts=3)
@authorize("admin")
async def send(
    request: Request,
    options: Options,
) -> Response:
    """Send a request."""
    prepare()
    validate()
    record()
    before()
    dispatch(previous)
    after()
    trace()
    flush()
    finish()
"#;
    let after = r#"# Request entrypoint.
@retry(attempts=3)
@authorize("admin")
async def send(
    request: Request,
    options: Options,
) -> Response:
    """Send a request."""
    prepare()
    validate()
    record()
    before()
    dispatch(next)
    after()
    trace()
    flush()
    finish()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   # Request entrypoint.
    2     2   @retry(attempts=3)
    3     3   @authorize("admin")
    4     4   async def send(
    5     5       request: Request,
    6     6       options: Options,
    7     7   ) -> Response:
    8     8       """Send a request."""
              … base 9–11 / head 9–11 collapsed [fold_state_id=59] …
   12    12       before()
   13       -     dispatch(previous)
         13 +     dispatch(next)
   14    14       after()
              … base 15–17 / head 15–17 collapsed [fold_state_id=61] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, conditional-path, loop-shell
#[test]
fn recursive_if_and_loop_context() {
    // Setup
    let before = r#"def send():
    if ready:
        for item in items:
            prepare()
            validate()
            record()
            before()
            dispatch(previous)
            after()
            trace()
            flush()
            finish()
"#;
    let after = r#"def send():
    if ready:
        for item in items:
            prepare()
            validate()
            record()
            before()
            dispatch(next)
            after()
            trace()
            flush()
            finish()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       if ready:
    3     3           for item in items:
              … base 4–6 / head 4–6 collapsed [fold_state_id=53] …
    7     7               before()
    8       -             dispatch(previous)
          8 +             dispatch(next)
    9     9               after()
              … base 10–12 / head 10–12 collapsed [fold_state_id=55] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: conditional-path, conditional-siblings, handler-body
#[test]
fn sibling_conditions_and_short_branch() {
    // Setup
    let before = r#"def send():
    if ready:
        prepare()
        validate()
        before()
        dispatch(previous)
        after()
        flush()
        finish()
    elif fallback:
        recover()
        record()
        retry()
    else:
        close()
"#;
    let after = r#"def send():
    if ready:
        prepare()
        validate()
        before()
        dispatch(next)
        after()
        flush()
        finish()
    elif fallback:
        recover()
        record()
        retry()
    else:
        close()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       if ready:
              … base 3–4 / head 3–4 collapsed [fold_state_id=67] …
    5     5           before()
    6       -         dispatch(previous)
          6 +         dispatch(next)
    7     7           after()
              … base 8–9 / head 8–9 collapsed [fold_state_id=69] …
   10    10       elif fallback:
              … base 11–13 / head 11–13 collapsed [fold_state_id=22] …
   14    14       else:
   15    15           close()

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-shell, function-shell
#[test]
fn class_and_method_contract() {
    // Setup
    let before = r#"class Store(Base):
    def send(self, request: Request) -> Response:
        prepare()
        validate()
        record()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
        finish()
"#;
    let after = r#"class Store(Base):
    def send(self, request: Request) -> Response:
        prepare()
        validate()
        record()
        before()
        dispatch(next)
        after()
        trace()
        flush()
        finish()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   class Store(Base):
    2     2       def send(self, request: Request) -> Response:
              … base 3–5 / head 3–5 collapsed [fold_state_id=49] …
    6     6           before()
    7       -         dispatch(previous)
          7 +         dispatch(next)
    8     8           after()
              … base 9–11 / head 9–11 collapsed [fold_state_id=51] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn match_patterns_guards_and_sibling_cases() {
    // Setup
    let before = r#"def send(command):
    match command:
        case {"save": item} if item.ready:
            prepare()
            validate()
            before()
            dispatch(previous)
            after()
            flush()
            finish()
        case "retry":
            recover()
            record()
            retry()
        case _:
            close()
"#;
    let after = r#"def send(command):
    match command:
        case {"save": item} if item.ready:
            prepare()
            validate()
            before()
            dispatch(next)
            after()
            flush()
            finish()
        case "retry":
            recover()
            record()
            retry()
        case _:
            close()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send(command):
    2     2       match command:
    3     3           case {"save": item} if item.ready:
              … base 4–5 / head 4–5 collapsed [fold_state_id=73] …
    6     6               before()
    7       -             dispatch(previous)
          7 +             dispatch(next)
    8     8               after()
              … base 9–10 / head 9–10 collapsed [fold_state_id=75] …
   11    11           case "retry":
              … base 12–14 / head 12–14 collapsed [fold_state_id=25] …
   15    15           case _:
   16    16               close()

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: binding-shell, collection-shell
#[test]
fn binding_and_collection_boundaries() {
    // Setup
    let before = r#"routes = [
    "alpha",
    "beta",
    "gamma",
    "before",
    "previous",
    "after",
    "delta",
    "epsilon",
    "zeta",
]
"#;
    let after = r#"routes = [
    "alpha",
    "beta",
    "gamma",
    "before",
    "next",
    "after",
    "delta",
    "epsilon",
    "zeta",
]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   routes = [
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5       "before",
    6       -     "previous",
          6 +     "next",
    7     7       "after",
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   ]

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: call-shell, binding-shell
#[test]
fn callee_arguments_and_binding_or_return() {
    // Setup
    let before = r#"def send():
    return dispatch(
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
"#;
    let after = r#"def send():
    return dispatch(
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       return dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         next,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=23] …
   12    12       )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: import-envelope
#[test]
fn multiline_import_module_and_group() {
    // Setup
    let before = r#"from transport.client import (
    Alpha,
    Beta,
    Gamma,
    Before,
    previous,
    After,
    Delta,
    Epsilon,
    Zeta,
)
"#;
    let after = r#"from transport.client import (
    Alpha,
    Beta,
    Gamma,
    Before,
    next,
    After,
    Delta,
    Epsilon,
    Zeta,
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   from transport.client import (
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5       Before,
    6       -     previous,
          6 +     next,
    7     7       After,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: callback-shell, function-shell, call-shell
#[test]
fn lambda_signature_and_call_owner() {
    // Setup
    let before = r#"handler = (
    lambda request: dispatch(
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
)
"#;
    let after = r#"handler = (
    lambda request: dispatch(
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
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   handler = (
    2     2       lambda request: dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         next,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       )
   13    13   )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: string-shell, binding-shell
#[test]
fn multiline_string_delimiters_and_interpolation() {
    // Setup
    let before = r#"template = f"""
alpha
beta
gamma
before
{previous}
after
delta
epsilon
zeta
"""
"#;
    let after = r#"template = f"""
alpha
beta
gamma
before
{next}
after
delta
epsilon
zeta
"""
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   template = f"""
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5   before
    6       - {previous}
          6 + {next}
    7     7   after
              … base 8–10 / head 8–10 collapsed [fold_state_id=13] …
   11    11   """

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: expression-spine:N, binding-shell
#[test]
fn ordinary_operators_do_not_force_distant_operands_open() {
    // Setup
    let before = r#"def send():
    total = (
        alpha
        + beta
        + gamma
        + before
        + previous
        + after
        + delta
        + epsilon
        + zeta
    )
"#;
    let after = r#"def send():
    total = (
        alpha
        + beta
        + gamma
        + before
        + next
        + after
        + delta
        + epsilon
        + zeta
    )
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       total = (
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           + before
    7       -         + previous
          7 +         + next
    8     8           + after
              … base 9–11 / head 9–11 collapsed [fold_state_id=23] …
   12    12       )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: exception-shell, handler-body
#[test]
fn exception_clauses_radius_and_short_finally() {
    // Setup
    let before = r#"def send():
    try:
        prepare()
        validate()
        before()
        dispatch(previous)
        after()
        trace()
        flush()
    except TransportError as error:
        recover(error)
        record(error)
        retry(error)
    finally:
        close()
"#;
    let after = r#"def send():
    try:
        prepare()
        validate()
        before()
        dispatch(next)
        after()
        trace()
        flush()
    except TransportError as error:
        recover(error)
        record(error)
        retry(error)
    finally:
        close()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       try:
              … base 3–4 / head 3–4 collapsed [fold_state_id=67] …
    5     5           before()
    6       -         dispatch(previous)
          6 +         dispatch(next)
    7     7           after()
              … base 8–9 / head 8–9 collapsed [fold_state_id=69] …
   10    10       except TransportError as error:
              … base 11–13 / head 11–13 collapsed [fold_state_id=22] …
   14    14       finally:
   15    15           close()

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: resource-shell, assertion-envelope
#[test]
fn resource_scope_binding_and_assertion() {
    // Setup
    let before = r#"def send():
    with connect() as client:
        assert (
            alpha
            and beta
            and gamma
            and before
            and previous
            and after
            and delta
            and epsilon
            and zeta
        ), "request must be valid"
"#;
    let after = r#"def send():
    with connect() as client:
        assert (
            alpha
            and beta
            and gamma
            and before
            and next
            and after
            and delta
            and epsilon
            and zeta
        ), "request must be valid"
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send():
    2     2       with connect() as client:
    3     3           assert (
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               and before
    8       -             and previous
          8 +             and next
    9     9               and after
              … base 10–12 / head 10–12 collapsed [fold_state_id=27] …
   13    13           ), "request must be valid"

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: comprehension-shell, collection-shell, binding-shell
#[test]
fn comprehension_binder_iterable_and_predicate() {
    // Setup
    let before = r#"result = [
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
    for item in items
    if item.ready
]
"#;
    let after = r#"result = [
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
    for item in items
    if item.ready
]
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   result = [
    2     2       dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         next,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=33] …
   12    12       )
   13    13       for item in items
   14    14       if item.ready
   15    15   ]

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: value-operation
#[test]
fn yield_wrapper() {
    // Setup
    let before = r#"def stream():
    yield (
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
    )
"#;
    let after = r#"def stream():
    yield (
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
    )
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def stream():
    2     2       yield (
    3     3           dispatch(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=29] …
   13    13           )
   14    14       )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: async-qualifiers, value-operation
#[test]
fn await_and_raise_wrappers() {
    // Setup
    let before = r#"async def send():
    raise (
        await make_error(
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
    )
"#;
    let after = r#"async def send():
    raise (
        await make_error(
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
    )
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   async def send():
    2     2       raise (
    3     3           await make_error(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7               before,
    8       -             previous,
          8 +             next,
    9     9               after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=29] …
   13    13           )
   14    14       )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-operators, type-shell
// Keep union alternative heads; this is a type annotation below, not an arbitrary runtime | expression.
#[test]
fn union_type_alternatives() {
    // Setup
    let before = r#"result: (
    Alpha
    | Beta
    | Gamma
    | Before
    | previous
    | After
    | Delta
    | Epsilon
    | Zeta
)
"#;
    let after = r#"result: (
    Alpha
    | Beta
    | Gamma
    | Before
    | next
    | After
    | Delta
    | Epsilon
    | Zeta
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   result: (
    2     2       Alpha
    3     3       | Beta
    4     4       | Gamma
    5     5       | Before
    6       -     | previous
          6 +     | next
    7     7       | After
    8     8       | Delta
    9     9       | Epsilon
   10    10       | Zeta
   11    11   )
"#
    );
}

// Contracts: function-shell, parameter-siblings
#[test]
fn changed_parameter_keeps_sibling_names() {
    // Setup
    let before = r#"def send(
    alpha: Argument,
    beta: Argument,
    gamma: Argument,
    before: Argument,
    value: previous,
    after: Argument,
    delta: Argument,
    epsilon: Argument,
    zeta: Argument,
):
    prepare()
    record()
    finish()
"#;
    let after = r#"def send(
    alpha: Argument,
    beta: Argument,
    gamma: Argument,
    before: Argument,
    value: next,
    after: Argument,
    delta: Argument,
    epsilon: Argument,
    zeta: Argument,
):
    prepare()
    record()
    finish()
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   def send(
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
   11    11   ):
              … base 12–14 / head 12–14 collapsed [fold_state_id=25] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: collection-shell, binding-shell
#[test]
fn named_collection_key_and_value() {
    // Setup
    let before = r#"config = {
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
    let after = r#"config = {
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
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   config = {
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5       "before": 4,
    6       -     "value": previous,
          6 +     "value": next,
    7     7       "after": 5,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: callback-shell, call-shell
#[test]
fn lambda_enclosing_call() {
    // Setup
    let before = r#"send(
    lambda request: dispatch(
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
)
"#;
    let after = r#"send(
    lambda request: dispatch(
        alpha,
        beta,
        gamma,
        before,
        updated,
        after,
        delta,
        epsilon,
        zeta,
    )
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   send(
    2     2       lambda request: dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         updated,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12       )
   13    13   )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: conditional-path, conditional-siblings, binding-shell
#[test]
fn conditional_expression_branches() {
    // Setup
    let before = r#"result = (
    compute(
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
    if enabled
    else fallback
)
"#;
    let after = r#"result = (
    compute(
        alpha,
        beta,
        gamma,
        before,
        updated,
        after,
        delta,
        epsilon,
        zeta,
    )
    if enabled
    else fallback
)
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.py", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.py → head/example.py — base → head
 base  head
    1     1   result = (
    2     2       compute(
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6           before,
    7       -         previous,
          7 +         updated,
    8     8           after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=31] …
   12    12       )
   13    13       if enabled
   14    14       else fallback
   15    15   )

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
