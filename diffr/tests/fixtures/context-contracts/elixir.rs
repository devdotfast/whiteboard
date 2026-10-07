//! elixir context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-clause-siblings, call-shell
#[test]
fn function_and_lexical_forms() {
    // Setup
    let before = r#"defmodule Transport do
  def send(request) do
    prepare()
    validate()
    record()
    before()
    dispatch(previous)
    after()
    trace()
    flush()
    finish()
  end
end
"#;
    let after = r#"defmodule Transport do
  def send(request) do
    prepare()
    validate()
    record()
    before()
    dispatch(updated)
    after()
    trace()
    flush()
    finish()
  end
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ex", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ex → head/example.ex — base → head
 base  head
    1     1   defmodule Transport do
    2     2     def send(request) do
              … base 3–5 / head 3–5 collapsed [fold_state_id=51] …
    6     6       before()
    7       -     dispatch(previous)
          7 +     dispatch(updated)
    8     8       after()
              … base 9–11 / head 9–11 collapsed [fold_state_id=53] …
   12    12     end
   13    13   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: function-clause-siblings, function-shell
#[test]
fn same_function_clause_headers() {
    // Setup
    let before = r#"defmodule Store do
  def send(:first) do
    prepare()
    validate()
    record()
    finish()
  end
  def send(:second) do
    prepare()
    validate()
    before()
    dispatch(previous)
    after()
    trace()
    finish()
  end
  def send(:third) do
    prepare()
    validate()
    record()
    finish()
  end
end
"#;
    let after = r#"defmodule Store do
  def send(:first) do
    prepare()
    validate()
    record()
    finish()
  end
  def send(:second) do
    prepare()
    validate()
    before()
    dispatch(updated)
    after()
    trace()
    finish()
  end
  def send(:third) do
    prepare()
    validate()
    record()
    finish()
  end
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ex", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ex → head/example.ex — base → head
 base  head
    1     1   defmodule Store do
    2     2     def send(:first) do
              … base 3–6 / head 3–6 collapsed [fold_state_id=6] …
    7     7     end
    8     8     def send(:second) do
              … base 9–10 / head 9–10 collapsed [fold_state_id=93] …
   11    11       before()
   12       -     dispatch(previous)
         12 +     dispatch(updated)
   13    13       after()
              … base 14–15 / head 14–15 collapsed [fold_state_id=95] …
   16    16     end
   17    17     def send(:third) do
              … base 18–21 / head 18–21 collapsed [fold_state_id=35] …
   22    22     end
   23    23   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: switch-path, switch-siblings
#[test]
fn case_sibling_headers() {
    // Setup
    let before = r#"defmodule Store do
  def send(value) do
    case value do
      :first ->
        prepare()
        validate()
        record()
        finish()
      :second ->
        prepare()
        validate()
        before()
        dispatch(previous)
        after_value()
        finish()
      :third ->
        prepare()
        validate()
        record()
        finish()
    end
  end
end
"#;
    let after = r#"defmodule Store do
  def send(value) do
    case value do
      :first ->
        prepare()
        validate()
        record()
        finish()
      :second ->
        prepare()
        validate()
        before()
        dispatch(updated)
        after_value()
        finish()
      :third ->
        prepare()
        validate()
        record()
        finish()
    end
  end
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.ex", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.ex → head/example.ex — base → head
 base  head
    1     1   defmodule Store do
    2     2     def send(value) do
    3     3       case value do
    4     4         :first ->
              … base 5–8 / head 5–8 collapsed [fold_state_id=10] …
    9     9         :second ->
              … base 10–11 / head 10–11 collapsed [fold_state_id=97] …
   12    12           before()
   13       -         dispatch(previous)
         13 +         dispatch(updated)
   14    14           after_value()
   15    15           finish()
   16    16         :third ->
              … base 17–20 / head 17–20 collapsed [fold_state_id=36] …
   21    21       end
   22    22     end
   23    23   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
