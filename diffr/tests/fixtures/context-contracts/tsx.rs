//! Approved tsx context contracts; using the real diff and Rust pprint.

use super::{pprint_after_opening, pprint_diff, OpenFold};

// Contracts: jsx-sibling-subtree
// packages/review/app/src/diffr-config-section.tsx, 38a74d5fe^ → 38a74d5fe.
// The long, unchanged AI summaries JSX follows edits to Display settings.
#[test]
fn diffr_config_section_folds_unchanged_ai_summaries() {
    let before = include_str!("tsx-diffr-config-section/before.tsx");
    let after = include_str!("tsx-diffr-config-section/after.tsx");
    let actual = pprint_diff("diffr-config-section.tsx", before, after, 3);

    assert_eq!(
        actual,
        include_str!("tsx-diffr-config-section/expected.pprint")
    );
}

// Contracts: jsx-sibling-subtree
#[test]
fn jsx_sibling_subtree() {
    // Setup
    let before = r#"<Page>
  <Sidebar>
    <Nav />
    <Filters />
    <Help />
    <Footer />
  </Sidebar>
  <Main>
    <Title />
    <Panel>
      <Caption />
      <Value value={previous} />
      <Legend />
    </Panel>
  </Main>
</Page>
"#;
    let after = r#"<Page>
  <Sidebar>
    <Nav />
    <Filters />
    <Help />
    <Footer />
  </Sidebar>
  <Main>
    <Title />
    <Panel>
      <Caption />
      <Value value={next} />
      <Legend />
    </Panel>
  </Main>
</Page>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Page>
    2     2     <Sidebar>
              … base 3–6 / head 3–6 collapsed [fold_state_id=6] …
    7     7     </Sidebar>
    8     8     <Main>
    9     9       <Title />
   10    10       <Panel>
   11    11         <Caption />
   12       -       <Value value={previous} />
         12 +       <Value value={next} />
   13    13         <Legend />
   14    14       </Panel>
   15    15     </Main>
   16    16   </Page>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-object-prop
#[test]
fn jsx_object_prop() {
    // Setup
    let before = r#"<Chart
  options={{
    color: "blue",
    spacing: 12,
    theme: "light",
    ticks: 5,
    before: 2,
    value: previous,
    after: 3,
    cap: 10,
    grid: true,
    legend: true,
    labels: true,
  }}
  title="Revenue"
/>
"#;
    let after = r#"<Chart
  options={{
    color: "blue",
    spacing: 12,
    theme: "light",
    ticks: 5,
    before: 2,
    value: next,
    after: 3,
    cap: 10,
    grid: true,
    legend: true,
    labels: true,
  }}
  title="Revenue"
/>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Chart
    2     2     options={{
              … base 3–6 / head 3–6 collapsed [fold_state_id=6] …
    7     7       before: 2,
    8       -     value: previous,
          8 +     value: next,
    9     9       after: 3,
              … base 10–13 / head 10–13 collapsed [fold_state_id=29] …
   14    14     }}
   15    15     title="Revenue"
   16    16   />

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-callback-prop
#[test]
fn jsx_callback_prop() {
    // Setup
    let before = r#"<Button
  onClick={async (event) => {
    prepare(event);
    validate(event);
    log(event);
    before();
    dispatch(previous);
    after();
    trace();
    flush();
    sync();
  }}
  disabled={false}
/>
"#;
    let after = r#"<Button
  onClick={async (event) => {
    prepare(event);
    validate(event);
    log(event);
    before();
    dispatch(next);
    after();
    trace();
    flush();
    sync();
  }}
  disabled={false}
/>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Button
    2     2     onClick={async (event) => {
              … base 3–5 / head 3–5 collapsed [fold_state_id=57] …
    6     6       before();
    7       -     dispatch(previous);
          7 +     dispatch(next);
    8     8       after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=59] …
   12    12     }}
   13    13     disabled={false}
   14    14   />

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-spread-value
#[test]
fn jsx_spread_value() {
    // Setup
    let before = r#"<Panel
  {...{
    role: "main",
    tabIndex: 0,
    draggable: false,
    before: 2,
    value: previous,
    after: 3,
    hidden: false,
    title: "Panel",
    lang: "en",
  }}
/>
"#;
    let after = r#"<Panel
  {...{
    role: "main",
    tabIndex: 0,
    draggable: false,
    before: 2,
    value: next,
    after: 3,
    hidden: false,
    title: "Panel",
    lang: "en",
  }}
/>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Panel
    2     2     {...{
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before: 2,
    7       -     value: previous,
          7 +     value: next,
    8     8       after: 3,
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     }}
   13    13   />

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-expression-child
#[test]
fn jsx_expression_child() {
    // Setup
    let before = r#"<>
  <List>
    {items.map((item) => (
      <Row key={item.id}>
        <Static>
          <Icon />
          <Badge />
          <Help />
          <Footer />
        </Static>
        <Label>{item.title}</Label>
        <Value>{render(previous)}</Value>
        <Hint />
      </Row>
    ))}
  </List>
</>
"#;
    let after = r#"<>
  <List>
    {items.map((item) => (
      <Row key={item.id}>
        <Static>
          <Icon />
          <Badge />
          <Help />
          <Footer />
        </Static>
        <Label>{item.title}</Label>
        <Value>{render(next)}</Value>
        <Hint />
      </Row>
    ))}
  </List>
</>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <>
    2     2     <List>
    3     3       {items.map((item) => (
    4     4         <Row key={item.id}>
    5     5           <Static>
              … base 6–9 / head 6–9 collapsed [fold_state_id=12] …
   10    10           </Static>
   11    11           <Label>{item.title}</Label>
   12       -         <Value>{render(previous)}</Value>
         12 +         <Value>{render(next)}</Value>
   13    13           <Hint />
   14    14         </Row>
   15    15       ))}
   16    16     </List>
   17    17   </>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-conditional-tree
#[test]
fn jsx_conditional_tree() {
    // Setup
    let before = r#"<Page>
  {ready ? (
    <Results>
      <Heading />
      <Value value={previous} />
      <Footer />
    </Results>
  ) : (
    <EmptyState>
      <Icon />
      <Message />
      <Help />
      <Action />
    </EmptyState>
  )}
</Page>
"#;
    let after = r#"<Page>
  {ready ? (
    <Results>
      <Heading />
      <Value value={next} />
      <Footer />
    </Results>
  ) : (
    <EmptyState>
      <Icon />
      <Message />
      <Help />
      <Action />
    </EmptyState>
  )}
</Page>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Page>
    2     2     {ready ? (
    3     3       <Results>
    4     4         <Heading />
    5       -       <Value value={previous} />
          5 +       <Value value={next} />
    6     6         <Footer />
    7     7       </Results>
    8     8     ) : (
    9     9       <EmptyState>
              … base 10–13 / head 10–13 collapsed [fold_state_id=19] …
   14    14       </EmptyState>
   15    15     )}
   16    16   </Page>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-sibling-run:refined
// The note specifies progressive disclosure, rather than approving the original flat-run case unchanged.
#[test]
fn sibling_run_initially_collapsed() {
    // Setup
    let before = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={previous} />
  <Footer />
</Page>
"#;
    let after = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={next} />
  <Footer />
</Page>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Page>
              … base 2–8 / head 2–8 collapsed [fold_state_id=51] …
    9     9     <Divider />
   10       -   <Result value={previous} />
         10 +   <Result value={next} />
   11    11     <Footer />
   12    12   </Page>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-sibling-run:refined
#[test]
fn opening_run_reveals_header_with_body_still_folded() {
    // Setup
    let before = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={previous} />
  <Footer />
</Page>
"#;
    let after = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={next} />
  <Footer />
</Page>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_after_opening(
        "example.tsx",
        before,
        after,
        1,
        &[OpenFold::RunStartingAt(2)],
    );

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Page>
    2     2     <Header>
              … base 3–4 / head 3–4 collapsed [fold_state_id=6] …
    5     5     </Header>
    6     6     <Nav />
    7     7     <Promo />
    8     8     <Help />
    9     9     <Divider />
   10       -   <Result value={previous} />
         10 +   <Result value={next} />
   11    11     <Footer />
   12    12   </Page>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: jsx-sibling-run:refined
#[test]
fn opening_header_body_reveals_its_children() {
    // Setup
    let before = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={previous} />
  <Footer />
</Page>
"#;
    let after = r#"<Page>
  <Header>
    <Thumbnail />
    <Menu />
  </Header>
  <Nav />
  <Promo />
  <Help />
  <Divider />
  <Result value={next} />
  <Footer />
</Page>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_after_opening(
        "example.tsx",
        before,
        after,
        1,
        &[OpenFold::RunStartingAt(2), OpenFold::BodyOf(2)],
    );

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   <Page>
    2     2     <Header>
    3     3       <Thumbnail />
    4     4       <Menu />
    5     5     </Header>
    6     6     <Nav />
    7     7     <Promo />
    8     8     <Help />
    9     9     <Divider />
   10       -   <Result value={previous} />
         10 +   <Result value={next} />
   11    11     <Footer />
   12    12   </Page>
"#
    );
}

// Contracts: function-shell, parameter-siblings, conditional-path, conditional-siblings
#[test]
fn signature_and_sibling_branches() {
    // Setup
    let before = r#"function send(
    first: number,
    second: number,
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
    let after = r#"function send(
    first: number,
    second: number,
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   function send(
    2     2       first: number,
    3     3       second: number,
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
    let before = r#"function send() {
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
"#;
    let after = r#"function send() {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   function send() {
    2     2     try {
              … base 3–5 / head 3–5 collapsed [fold_state_id=77] …
    6     6       before();
    7       -     dispatch(previous);
          7 +     dispatch(updated);
    8     8       after();
              … base 9–11 / head 9–11 collapsed [fold_state_id=79] …
   12    12     } catch (error) {
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

// Contracts: binding-shell, call-shell
#[test]
fn binding_and_nested_call_arguments() {
    // Setup
    let before = r#"function send() {
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
"#;
    let after = r#"function send() {
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
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   function send() {
    2     2     const response = dispatch(
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

// Contracts: function-shell, documentation, parameter-siblings, attached-comments
#[test]
fn inherited_complete_exported_signature_and_documentation() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_recursive_if_and_loop_context() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_sibling_conditions_and_short_branch() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_namespace_class_heritage_and_decorator() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_switch_selector_and_sibling_cases() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_binding_and_collection_boundaries() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_callee_arguments_and_binding_or_return() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_multiline_import_module_and_group() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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

// Contracts: callback-shell, function-shell, call-shell
#[test]
fn inherited_callback_signature_and_call_owner() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_multiline_string_delimiters_and_interpolation() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_ordinary_operators_do_not_force_distant_operands_open() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_exception_clauses_radius_and_short_finally() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_static_initializer_scope() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
#[test]
fn inherited_overload_signatures_if_straightforward() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_satisfies_type_around_changed_object() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_conditional_type_test_and_alternative() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
#[test]
fn inherited_labeled_loop() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_generator_yield_and_throw_value() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_throw_operation_around_changed_error() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_union_intersection_type_operators() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_changed_parameter_keeps_sibling_names() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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
fn inherited_named_collection_key_and_value() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
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

// Contracts: type-shell, documentation, function-shell
#[test]
fn type_and_attached_documentation() {
    // Setup
    let before = r#"/** Transport documentation. */
class Store extends Base {
  send() {
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
  send() {
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
    let actual = pprint_diff("example.tsx", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.tsx → head/example.tsx — base → head
 base  head
    1     1   /** Transport documentation. */
    2     2   class Store extends Base {
    3     3     send() {
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
