//! verilog context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: activation-context
#[test]
fn activation_context() {
    // Setup
    let before = r#"module transport;
  always @(posedge clk) begin
    alpha <= 1;
    beta <= 2;
    gamma <= 3;
    before <= 4;
    value <= previous;
    after_work <= 5;
    delta <= 6;
    epsilon <= 7;
    zeta <= 8;
  end
endmodule
"#;
    let after = r#"module transport;
  always @(posedge clk) begin
    alpha <= 1;
    beta <= 2;
    gamma <= 3;
    before <= 4;
    value <= updated;
    after_work <= 5;
    delta <= 6;
    epsilon <= 7;
    zeta <= 8;
  end
endmodule
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.sv", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.sv → head/example.sv — base → head
 base  head
    1     1   module transport;
    2     2     always @(posedge clk) begin
              … base 3–5 / head 3–5 collapsed [fold_state_id=6] …
    6     6       before <= 4;
    7       -     value <= previous;
          7 +     value <= updated;
    8     8       after_work <= 5;
              … base 9–11 / head 9–11 collapsed [fold_state_id=25] …
   12    12     end
   13    13   endmodule

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
