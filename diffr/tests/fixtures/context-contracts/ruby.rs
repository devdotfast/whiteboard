//! ruby context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"class Store
  def send(first, second)
    if ready
      prepare()
      validate()
      record()
      before()
      dispatch(previous)
      after()
      trace()
      flush()
      finish()
    else
      recover()
      retry()
      cleanup()
    end
  end
end
"#;
    let after = r#"class Store
  def send(first, second)
    if ready
      prepare()
      validate()
      record()
      before()
      dispatch(updated)
      after()
      trace()
      flush()
      finish()
    else
      recover()
      retry()
      cleanup()
    end
  end
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rb", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rb → head/example.rb — base → head
 base  head
    1     1   class Store
    2     2     def send(first, second)
    3     3       if ready
              … base 4–6 / head 4–6 collapsed [fold_state_id=73] …
    7     7         before()
    8       -       dispatch(previous)
          8 +       dispatch(updated)
    9     9         after()
              … base 10–12 / head 10–12 collapsed [fold_state_id=75] …
   13    13       else
              … base 14–16 / head 14–16 collapsed [fold_state_id=77] …
   17    17       end
   18    18     end
   19    19   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: access-section, function-shell
#[test]
fn effective_visibility() {
    // Setup
    let before = r#"class Store
  private
  def unrelated
    work()
  end
  def send
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
  public
  def other
    work()
  end
end
"#;
    let after = r#"class Store
  private
  def unrelated
    work()
  end
  def send
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
  public
  def other
    work()
  end
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.rb", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.rb → head/example.rb — base → head
 base  head
    1     1   class Store
              … base 2–5 / head 2–5 collapsed [fold_state_id=83] …
    6     6     def send
              … base 7–9 / head 7–9 collapsed [fold_state_id=79] …
   10    10       before()
   11       -     dispatch(previous)
         11 +     dispatch(updated)
   12    12       after()
              … base 13–15 / head 13–15 collapsed [fold_state_id=81] …
   16    16     end
              … base 17–20 / head 17–20 collapsed [fold_state_id=85] …
   21    21   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
