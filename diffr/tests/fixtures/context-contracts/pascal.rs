//! pascal context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"program Transport;
procedure Send(First: Integer; Second: Integer);
begin
  if Ready then
  begin
    Prepare;
    Validate;
    Record;
    Before;
    Dispatch(previous);
    After;
    Trace;
    Flush;
    Finish;
  end
  else
  begin
    Recover;
    Retry;
    Cleanup;
  end;
end;
begin
end.
"#;
    let after = r#"program Transport;
procedure Send(First: Integer; Second: Integer);
begin
  if Ready then
  begin
    Prepare;
    Validate;
    Record;
    Before;
    Dispatch(updated);
    After;
    Trace;
    Flush;
    Finish;
  end
  else
  begin
    Recover;
    Retry;
    Cleanup;
  end;
end;
begin
end.
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.pas", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.pas → head/example.pas — base → head
 base  head
    1     1   program Transport;
    2     2   procedure Send(First: Integer; Second: Integer);
    3     3   begin
    4     4     if Ready then
    5     5     begin
              … base 6–8 / head 6–8 collapsed [fold_state_id=9] …
    9     9       Before;
   10       -     Dispatch(previous);
         10 +     Dispatch(updated);
   11    11       After;
              … base 12–14 / head 12–14 collapsed [fold_state_id=39] …
   15    15     end
   16    16     else
   17    17     begin
              … base 18–20 / head 18–20 collapsed [fold_state_id=14] …
   21    21     end;
   22    22   end;
              … base 23–24 / head 23–24 collapsed [fold_state_id=17] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
