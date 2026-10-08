//! vhdl context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: activation-context
#[test]
fn activation_context() {
    // Setup
    let before = r#"architecture rtl of blinky is
begin
  process(clk)
  begin
    alpha <= 1;
    beta <= 2;
    gamma <= 3;
    before <= 4;
    value <= previous;
    after_work <= 5;
    delta <= 6;
    epsilon <= 7;
    zeta <= 8;
  end process;
end architecture;
"#;
    let after = r#"architecture rtl of blinky is
begin
  process(clk)
  begin
    alpha <= 1;
    beta <= 2;
    gamma <= 3;
    before <= 4;
    value <= updated;
    after_work <= 5;
    delta <= 6;
    epsilon <= 7;
    zeta <= 8;
  end process;
end architecture;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.vhd", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.vhd → head/example.vhd — base → head
 base  head
    1     1   architecture rtl of blinky is
    2     2   begin
    3     3     process(clk)
              … base 4–7 / head 4–7 collapsed [fold_state_id=8] …
    8     8       before <= 4;
    9       -     value <= previous;
          9 +     value <= updated;
   10    10       after_work <= 5;
              … base 11–13 / head 11–13 collapsed [fold_state_id=29] …
   14    14     end process;
   15    15   end architecture;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
