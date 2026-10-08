//! fortran context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell, conditional-path, conditional-siblings
#[test]
fn recursive_control() {
    // Setup
    let before = r#"subroutine send(first, second)
  integer :: first, second
  if (ready) then
    call prepare()
    call validate()
    call record()
    call before()
    call dispatch(previous)
    call after()
    call trace()
    call flush()
    call finish()
  else
    call recover()
    call retry()
    call cleanup()
  end if
end subroutine send
"#;
    let after = r#"subroutine send(first, second)
  integer :: first, second
  if (ready) then
    call prepare()
    call validate()
    call record()
    call before()
    call dispatch(updated)
    call after()
    call trace()
    call flush()
    call finish()
  else
    call recover()
    call retry()
    call cleanup()
  end if
end subroutine send
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.f90", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.f90 → head/example.f90 — base → head
 base  head
    1     1   subroutine send(first, second)
    2     2     integer :: first, second
    3     3     if (ready) then
              … base 4–6 / head 4–6 collapsed [fold_state_id=8] …
    7     7       call before()
    8       -     call dispatch(previous)
          8 +     call dispatch(updated)
    9     9       call after()
              … base 10–12 / head 10–12 collapsed [fold_state_id=35] …
   13    13     else
              … base 14–16 / head 14–16 collapsed [fold_state_id=11] …
   17    17     end if
   18    18   end subroutine send

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
