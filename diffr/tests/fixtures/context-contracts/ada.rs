//! ada context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"procedure Send (First : Integer; Second : Integer) is
begin
   if Ready then
      Prepare;
      Validate;
      Record;
      Before;
      Dispatch (previous);
      After;
      Trace;
      Flush;
      Finish;
   else
      Recover;
      Retry;
      Cleanup;
   end if;
end Send;
"#;
    let after = r#"procedure Send (First : Integer; Second : Integer) is
begin
   if Ready then
      Prepare;
      Validate;
      Record;
      Before;
      Dispatch (updated);
      After;
      Trace;
      Flush;
      Finish;
   else
      Recover;
      Retry;
      Cleanup;
   end if;
end Send;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.adb", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.adb → head/example.adb — base → head
 base  head
    1     1   procedure Send (First : Integer; Second : Integer) is
    2     2   begin
    3     3      if Ready then
              … base 4–6 / head 4–6 collapsed [fold_state_id=6] …
    7     7         Before;
    8       -       Dispatch (previous);
          8 +       Dispatch (updated);
    9     9         After;
              … base 10–12 / head 10–12 collapsed [fold_state_id=33] …
   13    13      else
              … base 14–16 / head 14–16 collapsed [fold_state_id=11] …
   17    17      end if;
   18    18   end Send;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
