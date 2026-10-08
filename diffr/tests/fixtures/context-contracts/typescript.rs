//! Approved typescript context contracts; using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, documentation, parameter-siblings, attached-comments
#[test]
fn complete_exported_signature_and_documentation() {
    // Setup
    let before = r#"/** Send a request. */
export async function send<T extends Request>(
  request: T,
  options: Options,
): Promise<Response> {
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
    let after = r#"/** Send a request. */
export async function send<T extends Request>(
  request: T,
  options: Options,
): Promise<Response> {
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   /** Send a request. */
    2     2   export async function send<T extends Request>(
    3     3     request: T,
    4     4     options: Options,
    5     5   ): Promise<Response> {
              … base 6–8 / head 6–8 collapsed [fold_state_id=49] …
    9     9     before();
   10       -   dispatch(previous);
         10 +   dispatch(next);
   11    11     after();
              … base 12–14 / head 12–14 collapsed [fold_state_id=51] …
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, conditional-path, loop-shell
#[test]
fn recursive_if_and_loop_context() {
    // Setup
    let before = r#"function send() {
    if (ready) {
        for (const item of items) {
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
    let after = r#"function send() {
    if (ready) {
        for (const item of items) {
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2       if (ready) {
    3     3           for (const item of items) {
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
    let before = r#"function send() {
    if (ready) {
        prepare();
        validate();
        before();
        dispatch(previous);
        after();
        flush();
        finish();
    } else if (fallback) {
        recover();
        record();
        retry();
    } else {
        close();
    }
}
"#;
    let after = r#"function send() {
    if (ready) {
        prepare();
        validate();
        before();
        dispatch(next);
        after();
        flush();
        finish();
    } else if (fallback) {
        recover();
        record();
        retry();
    } else {
        close();
    }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2       if (ready) {
              … base 3–4 / head 3–4 collapsed [fold_state_id=71] …
    5     5           before();
    6       -         dispatch(previous);
          6 +         dispatch(next);
    7     7           after();
              … base 8–9 / head 8–9 collapsed [fold_state_id=73] …
   10    10       } else if (fallback) {
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

// Contracts: namespace-shell, type-shell, decorations, function-shell
#[test]
fn namespace_class_heritage_and_decorator() {
    // Setup
    let before = r#"namespace Transport {
  @sealed
  class Store<T extends Request> extends Base implements Sender {
    async send(request: T): Promise<Response> {
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
    let after = r#"namespace Transport {
  @sealed
  class Store<T extends Request> extends Base implements Sender {
    async send(request: T): Promise<Response> {
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   namespace Transport {
    2     2     @sealed
    3     3     class Store<T extends Request> extends Base implements Sender {
    4     4       async send(request: T): Promise<Response> {
              … base 5–7 / head 5–7 collapsed [fold_state_id=59] …
    8     8         before();
    9       -       dispatch(previous);
          9 +       dispatch(next);
   10    10         after();
              … base 11–13 / head 11–13 collapsed [fold_state_id=61] …
   14    14       }
   15    15     }
   16    16   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn switch_selector_and_sibling_cases() {
    // Setup
    let before = r#"function send(command: Command) {
  switch (command.kind) {
    case "save":
      prepare();
      validate();
      before();
      dispatch(previous);
      after();
      flush();
      finish();
      break;
    case "retry":
      recover();
      record();
      retry();
      break;
    default:
      close();
  }
}
"#;
    let after = r#"function send(command: Command) {
  switch (command.kind) {
    case "save":
      prepare();
      validate();
      before();
      dispatch(next);
      after();
      flush();
      finish();
      break;
    case "retry":
      recover();
      record();
      retry();
      break;
    default:
      close();
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send(command: Command) {
    2     2     switch (command.kind) {
    3     3       case "save":
              … base 4–5 / head 4–5 collapsed [fold_state_id=81] …
    6     6         before();
    7       -       dispatch(previous);
          7 +       dispatch(next);
    8     8         after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=83] …
   12    12       case "retry":
              … base 13–16 / head 13–16 collapsed [fold_state_id=26] …
   17    17       default:
   18    18         close();
   19    19     }
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
    let before = r#"export const routes: string[] = [
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
    let after = r#"export const routes: string[] = [
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   export const routes: string[] = [
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

// Contracts: call-shell, binding-shell, async-qualifiers
#[test]
fn callee_arguments_and_binding_or_return() {
    // Setup
    let before = r#"async function send() {
    const response = await dispatch(
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
    let after = r#"async function send() {
    const response = await dispatch(
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   async function send() {
    2     2       const response = await dispatch(
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
fn multiline_import_module_and_group() {
    // Setup
    let before = r#"import {
  Alpha,
  Beta,
  Gamma,
  Before,
  previous,
  After,
  Delta,
  Epsilon,
  Zeta,
} from "transport/client";
"#;
    let after = r#"import {
  Alpha,
  Beta,
  Gamma,
  Before,
  next,
  After,
  Delta,
  Epsilon,
  Zeta,
} from "transport/client";
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   import {
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5     Before,
    6       -   previous,
          6 +   next,
    7     7     After,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   } from "transport/client";

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: import-envelope
#[test]
fn removed_names_keep_import_closer() {
    let before = r#"// Header 1
// Header 2
// Header 3
// Header 4
// Header 5

import test from "node:test";
import { projectInlineSourceAlignment, projectSplitSourceAlignment } from "./alignment.js";
import {
  collapsedRegions,
  hiddenLinesOf,
  structuralContextGaps,
  bandDetail,
  structuralHighlights,
  structuralRows,
  utf16Column,
  type StructuralFold,
  type StructuralLeaf,
  type StructuralRegion,
  type StructuralTextDiff,
} from "./reviewStructuralDiff.js";

function fold(id: number, children: StructuralRegion[]): StructuralFold {
  return { id, children } as StructuralFold;
}
"#;
    let after = before.replace("  collapsedRegions,\n  hiddenLinesOf,\n", "");

    let actual = pprint_diff("example.ts", before, &after, 3);
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
              … base 1–6 / head 1–6 collapsed [fold_state_id=1] …
    7     7   import test from "node:test";
    8     8   import { projectInlineSourceAlignment, projectSplitSourceAlignment } from "./alignment.js";
    9     9   import {
   10       -   collapsedRegions,
   11       -   hiddenLinesOf,
   12    10     structuralContextGaps,
   13    11     bandDetail,
   14    12     structuralHighlights,
              … base 15–20 / head 13–18 collapsed [fold_state_id=36] …
   21    19   } from "./reviewStructuralDiff.js";
              … base 22–25 / head 20–23 collapsed [fold_state_id=38] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: callback-shell, function-shell, call-shell
#[test]
fn callback_signature_and_call_owner() {
    // Setup
    let before = r#"function send() {
    register(async (request: Request): Promise<void> => {
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
    let after = r#"function send() {
    register(async (request: Request): Promise<void> => {
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2       register(async (request: Request): Promise<void> => {
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
    let before = r#"const template = `
alpha
beta
gamma
before
${previous}
after
delta
epsilon
zeta
`;
"#;
    let after = r#"const template = `
alpha
beta
gamma
before
${next}
after
delta
epsilon
zeta
`;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   const template = `
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5   before
    6       - ${previous}
          6 + ${next}
    7     7   after
              … base 8–10 / head 8–10 collapsed [fold_state_id=13] …
   11    11   `;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: expression-spine:N, binding-shell
#[test]
fn ordinary_operators_do_not_force_distant_operands_open() {
    // Setup
    let before = r#"function send() {
    const total = (
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
    let after = r#"function send() {
    const total = (
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2       const total = (
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

// Contracts: exception-shell, handler-body
#[test]
fn exception_clauses_radius_and_short_finally() {
    // Setup
    let before = r#"function send() {
  try {
    prepare();
    validate();
    before();
    dispatch(previous);
    after();
    trace();
    flush();
  } catch (error) {
    recover(error);
    record(error);
    retry(error);
  } finally {
    close();
  }
}
"#;
    let after = r#"function send() {
  try {
    prepare();
    validate();
    before();
    dispatch(next);
    after();
    trace();
    flush();
  } catch (error) {
    recover(error);
    record(error);
    retry(error);
  } finally {
    close();
  }
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2     try {
              … base 3–4 / head 3–4 collapsed [fold_state_id=69] …
    5     5       before();
    6       -     dispatch(previous);
          6 +     dispatch(next);
    7     7       after();
              … base 8–9 / head 8–9 collapsed [fold_state_id=71] …
   10    10     } catch (error) {
              … base 11–13 / head 11–13 collapsed [fold_state_id=73] …
   14    14     } finally {
   15    15       close();
   16    16     }
   17    17   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: initializer-scope, type-shell
#[test]
fn static_initializer_scope() {
    // Setup
    let before = r#"class Store {
  static {
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
    let after = r#"class Store {
  static {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   class Store {
    2     2     static {
              … base 3–5 / head 3–5 collapsed [fold_state_id=53] …
    6     6       before();
    7       -     dispatch(previous);
          7 +     dispatch(next);
    8     8       after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=55] …
   12    12     }
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: overload-signatures
// Conditional approval: include only if straightforward; otherwise use ordinary context.
#[test]
fn overload_signatures_if_straightforward() {
    // Setup
    let before = r#"function send(x: string): Result;
function send(x: Request): Result;
function send(x: string | Request): Result {
  prepare(x);
  validate(x);
  record(x);
  before();
  dispatch(previous);
  after();
  trace();
  flush();
  finish();
}
"#;
    let after = r#"function send(x: string): Result;
function send(x: Request): Result;
function send(x: string | Request): Result {
  prepare(x);
  validate(x);
  record(x);
  before();
  dispatch(next);
  after();
  trace();
  flush();
  finish();
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
              … base 1–2 / head 1–2 collapsed [fold_state_id=1] …
    3     3   function send(x: string | Request): Result {
              … base 4–6 / head 4–6 collapsed [fold_state_id=49] …
    7     7     before();
    8       -   dispatch(previous);
          8 +   dispatch(next);
    9     9     after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=51] …
   13    13   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-assertion, collection-shell, binding-shell
#[test]
fn satisfies_type_around_changed_object() {
    // Setup
    let before = r#"const settings = {
  alpha: 1,
  beta: 2,
  gamma: 3,
  before: 4,
  value: previous,
  after: 5,
  delta: 6,
  epsilon: 7,
  zeta: 8,
} satisfies Config;
"#;
    let after = r#"const settings = {
  alpha: 1,
  beta: 2,
  gamma: 3,
  before: 4,
  value: next,
  after: 5,
  delta: 6,
  epsilon: 7,
  zeta: 8,
} satisfies Config;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   const settings = {
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5     before: 4,
    6       -   value: previous,
          6 +   value: next,
    7     7     after: 5,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   } satisfies Config;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-operators, type-shell
#[test]
fn conditional_type_test_and_alternative() {
    // Setup
    let before = r#"type Result<T> =
  T extends Request
    ? {
      alpha: string;
      beta: string;
      gamma: string;
      before: string;
      value: previous;
      after: string;
      delta: string;
      epsilon: string;
      zeta: string;
    }
    : Failure;
"#;
    let after = r#"type Result<T> =
  T extends Request
    ? {
      alpha: string;
      beta: string;
      gamma: string;
      before: string;
      value: next;
      after: string;
      delta: string;
      epsilon: string;
      zeta: string;
    }
    : Failure;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   type Result<T> =
    2     2     T extends Request
    3     3       ? {
              … base 4–6 / head 4–6 collapsed [fold_state_id=4] …
    7     7         before: string;
    8       -       value: previous;
          8 +       value: next;
    9     9         after: string;
              … base 10–12 / head 10–12 collapsed [fold_state_id=19] …
   13    13       }
   14    14       : Failure;

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
    let before = r#"function send() {
  retry:
  for (const item of items) {
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
    let after = r#"function send() {
  retry:
  for (const item of items) {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2     retry:
    3     3     for (const item of items) {
              … base 4–6 / head 4–6 collapsed [fold_state_id=57] …
    7     7       before();
    8       -     dispatch(previous);
          8 +     dispatch(next);
    9     9       after();
              … base 10–12 / head 10–12 collapsed [fold_state_id=59] …
   13    13     }
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: value-operation, function-shell
#[test]
fn generator_yield_and_throw_value() {
    // Setup
    let before = r#"function* stream() {
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
  throw new Error("stream closed");
}
"#;
    let after = r#"function* stream() {
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
  throw new Error("stream closed");
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function* stream() {
    2     2     yield dispatch(
              … base 3–5 / head 3–5 collapsed [fold_state_id=7] …
    6     6       before,
    7       -     previous,
          7 +     next,
    8     8       after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=31] …
   12    12     );
   13    13     throw new Error("stream closed");
   14    14   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: value-operation, call-shell
#[test]
fn throw_operation_around_changed_error() {
    // Setup
    let before = r#"function send() {
  throw (
    makeError(
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
  );
}
"#;
    let after = r#"function send() {
  throw (
    makeError(
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
  );
}
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send() {
    2     2     throw (
    3     3       makeError(
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7         before,
    8       -       previous,
          8 +       next,
    9     9         after,
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13       )
   14    14     );
   15    15   }

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: type-operators, type-shell
#[test]
fn union_intersection_type_operators() {
    // Setup
    let before = r#"type Event = (
  {
    alpha: string;
    beta: string;
    gamma: string;
    before: string;
    value: previous;
    after: string;
    delta: string;
    epsilon: string;
    zeta: string;
  }
  & Metadata
) | Failure;
"#;
    let after = r#"type Event = (
  {
    alpha: string;
    beta: string;
    gamma: string;
    before: string;
    value: next;
    after: string;
    delta: string;
    epsilon: string;
    zeta: string;
  }
  & Metadata
) | Failure;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   type Event = (
    2     2     {
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before: string;
    7       -     value: previous;
          7 +     value: next;
    8     8       after: string;
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     }
   13    13     & Metadata
   14    14   ) | Failure;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-shell, parameter-siblings
#[test]
fn changed_parameter_keeps_sibling_names() {
    // Setup
    let before = r#"function send(
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
    let after = r#"function send(
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
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   function send(
    2     2     alpha: Argument,
    3     3     beta: Argument,
    4     4     gamma: Argument,
    5     5     before: Argument,
    6       -   value: previous,
          6 +   value: next,
    7     7     after: Argument,
    8     8     delta: Argument,
    9     9     epsilon: Argument,
   10    10     zeta: Argument,
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
    let before = r#"const config = {
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
"#;
    let after = r#"const config = {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ts", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ts → head/example.ts — base → head
 base  head
    1     1   const config = {
              … base 2–4 / head 2–4 collapsed [fold_state_id=4] …
    5     5     before: 4,
    6       -   value: previous,
          6 +   value: next,
    7     7     after: 5,
              … base 8–10 / head 8–10 collapsed [fold_state_id=19] …
   11    11   };

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
