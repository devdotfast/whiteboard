//! ocamlinterface context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: namespace-shell
#[test]
fn module_signature() {
    // Setup
    let before = r#"module Transport : sig
  val alpha : string
  val beta : string
  val gamma : string
  val before : string
  val value : previous
  val after : string
  val delta : string
  val epsilon : string
  val zeta : string
end
"#;
    let after = r#"module Transport : sig
  val alpha : string
  val beta : string
  val gamma : string
  val before : string
  val value : updated
  val after : string
  val delta : string
  val epsilon : string
  val zeta : string
end
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.mli", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.mli → head/example.mli — base → head
 base  head
    1     1   module Transport : sig
              … base 2–4 / head 2–4 collapsed [fold_state_id=45] …
    5     5     val before : string
    6       -   val value : previous
          6 +   val value : updated
    7     7     val after : string
              … base 8–10 / head 8–10 collapsed [fold_state_id=47] …
   11    11   end

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
