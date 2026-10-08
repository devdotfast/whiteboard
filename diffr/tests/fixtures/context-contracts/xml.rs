//! xml context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: markup-path
#[test]
fn ancestor_tags_and_attributes() {
    // Setup
    let before = r#"<panel
  role="main"
  title="Settings">
  <section name="network">
    <item name="alpha" />
    <item name="beta" />
    <item name="gamma" />
    <item name="before" />
    <item name="previous" />
    <item name="after" />
    <item name="delta" />
    <item name="epsilon" />
    <item name="zeta" />
  </section>
</panel>
"#;
    let after = r#"<panel
  role="main"
  title="Settings">
  <section name="network">
    <item name="alpha" />
    <item name="beta" />
    <item name="gamma" />
    <item name="before" />
    <item name="updated" />
    <item name="after" />
    <item name="delta" />
    <item name="epsilon" />
    <item name="zeta" />
  </section>
</panel>
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.xml", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.xml → head/example.xml — base → head
 base  head
    1     1   <panel
    2     2     role="main"
    3     3     title="Settings">
    4     4     <section name="network">
              … base 5–7 / head 5–7 collapsed [fold_state_id=53] …
    8     8       <item name="before" />
    9       -     <item name="previous" />
          9 +     <item name="updated" />
   10    10       <item name="after" />
              … base 11–13 / head 11–13 collapsed [fold_state_id=55] …
   14    14     </section>
   15    15   </panel>

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
