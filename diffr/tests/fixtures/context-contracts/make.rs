//! make context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: build-config-shell
#[test]
fn named_target() {
    // Setup
    let before = r#"transport:
	@echo alpha
	@echo beta
	@echo gamma
	@echo before
	@echo previous
	@echo after
	@echo delta
	@echo epsilon
	@echo zeta
"#;
    let after = r#"transport:
	@echo alpha
	@echo beta
	@echo gamma
	@echo before
	@echo updated
	@echo after
	@echo delta
	@echo epsilon
	@echo zeta
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.mk", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.mk → head/example.mk — base → head
 base  head
    1     1   transport:
              … base 2–4 / head 2–4 collapsed [fold_state_id=13] …
    5     5   	@echo before
    6       - 	@echo previous
          6 + 	@echo updated
    7     7   	@echo after
              … base 8–10 / head 8–10 collapsed [fold_state_id=15] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
