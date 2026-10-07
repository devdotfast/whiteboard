//! asm context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: assembly-label-context
#[test]
fn ordinary_radius_between_flat_instructions() {
    // Setup
    let before = r#".text
send:
  nop
  nop
  nop
  mov rax, 1
  mov rbx, "previous"
  mov rcx, 2
  nop
  nop
  nop
  ret
"#;
    let after = r#".text
send:
  nop
  nop
  nop
  mov rax, 1
  mov rbx, "updated"
  mov rcx, 2
  nop
  nop
  nop
  ret
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.s", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.s → head/example.s — base → head
 base  head
              … base 1–5 / head 1–5 collapsed [fold_state_id=49] …
    6     6     mov rax, 1
    7       -   mov rbx, "previous"
          7 +   mov rbx, "updated"
    8     8     mov rcx, 2
              … base 9–12 / head 9–12 collapsed [fold_state_id=51] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: assembly-label-context
#[test]
fn distant_labels_use_ordinary_context() {
    // Setup
    let before = r#"old:
  nop
  nop
  ret
send:
  nop
  nop
  nop
  mov rax, 1
  mov rbx, previous
  mov rcx, 2
  nop
  nop
  ret
"#;
    let after = r#"old:
  nop
  nop
  ret
send:
  nop
  nop
  nop
  mov rax, 1
  mov rbx, updated
  mov rcx, 2
  nop
  nop
  ret
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.s", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.s → head/example.s — base → head
 base  head
              … base 1–8 / head 1–8 collapsed [fold_state_id=59] …
    9     9     mov rax, 1
   10       -   mov rbx, previous
         10 +   mov rbx, updated
   11    11     mov rcx, 2
              … base 12–14 / head 12–14 collapsed [fold_state_id=61] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: assembly-label-context
#[test]
fn nearby_label_uses_line_radius() {
    // Setup
    let before = r#"send:
  mov rbx, "previous"
  mov rcx, 2
  ret
"#;
    let after = r#"send:
  mov rbx, "updated"
  mov rcx, 2
  ret
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.s", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.s → head/example.s — base → head
 base  head
    1     1   send:
    2       -   mov rbx, "previous"
          2 +   mov rbx, "updated"
    3     3     mov rcx, 2
    4     4     ret
"#
    );
}
