//! sql context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: query-shell, sql-transaction-context
#[test]
fn transaction_query_structure() {
    // Setup
    let before = r#"BEGIN;
SELECT
  alpha,
  beta,
  gamma,
  before,
  previous AS value,
  after,
  delta,
  epsilon,
  zeta
FROM records
WHERE active = true
ORDER BY created_at;
COMMIT;
"#;
    let after = r#"BEGIN;
SELECT
  alpha,
  beta,
  gamma,
  before,
  updated AS value,
  after,
  delta,
  epsilon,
  zeta
FROM records
WHERE active = true
ORDER BY created_at;
COMMIT;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.sql", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.sql → head/example.sql — base → head
 base  head
    1     1   BEGIN;
    2     2   SELECT
              … base 3–5 / head 3–5 collapsed [fold_state_id=7] …
    6     6     before,
    7       -   previous AS value,
          7 +   updated AS value,
    8     8     after,
              … base 9–11 / head 9–11 collapsed [fold_state_id=35] …
   12    12   FROM records
   13    13   WHERE active = true
   14    14   ORDER BY created_at;
   15    15   COMMIT;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: sql-routine-context, function-shell
#[test]
fn routine_suffix_attributes() {
    // Setup
    let before = r#"CREATE FUNCTION send() RETURNS TEXT
AS $$
BEGIN
SELECT alpha;
SELECT beta;
SELECT gamma;
SELECT before_value;
SELECT previous;
SELECT after_value;
SELECT delta;
SELECT epsilon;
SELECT zeta;
END;
$$
LANGUAGE SQL
SECURITY DEFINER
IMMUTABLE;
"#;
    let after = r#"CREATE FUNCTION send() RETURNS TEXT
AS $$
BEGIN
SELECT alpha;
SELECT beta;
SELECT gamma;
SELECT before_value;
SELECT updated;
SELECT after_value;
SELECT delta;
SELECT epsilon;
SELECT zeta;
END;
$$
LANGUAGE SQL
SECURITY DEFINER
IMMUTABLE;
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("example.sql", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/example.sql → head/example.sql — base → head
 base  head
    1     1   CREATE FUNCTION send() RETURNS TEXT
    2     2   AS $$
    3     3   BEGIN
              … base 4–6 / head 4–6 collapsed [fold_state_id=4] …
    7     7   SELECT before_value;
    8       - SELECT previous;
          8 + SELECT updated;
    9     9   SELECT after_value;
              … base 10–12 / head 10–12 collapsed [fold_state_id=31] …
   13    13   END;
   14    14   $$
   15    15   LANGUAGE SQL
   16    16   SECURITY DEFINER
   17    17   IMMUTABLE;

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
