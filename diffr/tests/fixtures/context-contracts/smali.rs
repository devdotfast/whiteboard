//! smali context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: function-shell
#[test]
fn method_context() {
    // Setup
    let before = r#".class public LTransport;
.super Ljava/lang/Object;
.method public send()V
  .locals 2
  const/4 v0, 0x1
  const/4 v0, 0x2
  const/4 v0, 0x3
  const/4 v0, 0x4
  const-string v1, "previous"
  const/4 v0, 0x5
  const/4 v0, 0x6
  const/4 v0, 0x7
  return-void
.end method
"#;
    let after = r#".class public LTransport;
.super Ljava/lang/Object;
.method public send()V
  .locals 2
  const/4 v0, 0x1
  const/4 v0, 0x2
  const/4 v0, 0x3
  const/4 v0, 0x4
  const-string v1, "updated"
  const/4 v0, 0x5
  const/4 v0, 0x6
  const/4 v0, 0x7
  return-void
.end method
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.smali", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.smali → head/example.smali — base → head
 base  head
              … base 1–2 / head 1–2 collapsed [fold_state_id=1] …
    3     3   .method public send()V
              … base 4–7 / head 4–7 collapsed [fold_state_id=15] …
    8     8     const/4 v0, 0x4
    9       -   const-string v1, "previous"
          9 +   const-string v1, "updated"
   10    10     const/4 v0, 0x5
              … base 11–13 / head 11–13 collapsed [fold_state_id=19] …
   14    14   .end method

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
