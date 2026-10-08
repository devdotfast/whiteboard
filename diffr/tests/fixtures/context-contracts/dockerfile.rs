//! dockerfile context contracts, using the real diff and Rust pprint.

use super::pprint_diff;

// Contracts: docker-stage-context, docker-effective-context
#[test]
fn stage_and_effective_settings() {
    // Setup
    let before = r#"FROM alpine AS builder
WORKDIR /workspace
USER app
SHELL ["/bin/sh", "-c"]
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo previous
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
FROM scratch
COPY --from=builder /workspace /app
"#;
    let after = r#"FROM alpine AS builder
WORKDIR /workspace
USER app
SHELL ["/bin/sh", "-c"]
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo updated
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
FROM scratch
COPY --from=builder /workspace /app
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("Dockerfile", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/Dockerfile → head/Dockerfile — base → head
 base  head
              … base 1–7 / head 1–7 collapsed [fold_state_id=63] …
    8     8   RUN echo before
    9       - RUN echo previous
          9 + RUN echo updated
   10    10   RUN echo after
              … base 11–15 / head 11–15 collapsed [fold_state_id=65] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: docker-stage-context, docker-effective-context
#[test]
fn stage_reset() {
    // Setup
    let before = r#"FROM alpine AS old
WORKDIR /old
USER old
RUN echo old1
RUN echo old2
FROM alpine AS current
WORKDIR /workspace
USER app
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo previous
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
"#;
    let after = r#"FROM alpine AS old
WORKDIR /old
USER old
RUN echo old1
RUN echo old2
FROM alpine AS current
WORKDIR /workspace
USER app
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo updated
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("Dockerfile", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/Dockerfile → head/Dockerfile — base → head
 base  head
              … base 1–11 / head 1–11 collapsed [fold_state_id=71] …
   12    12   RUN echo before
   13       - RUN echo previous
         13 + RUN echo updated
   14    14   RUN echo after
              … base 15–17 / head 15–17 collapsed [fold_state_id=73] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}

// Contracts: docker-stage-context, docker-effective-context
#[test]
fn instructions_do_not_reset_effective_settings() {
    // Setup
    let before = r#"FROM alpine AS builder
WORKDIR /workspace
USER app
SHELL ["/bin/sh", "-c"]
LABEL owner="team"
EXPOSE 8080
ENTRYPOINT ["/app/start"]
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo previous
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
"#;
    let after = r#"FROM alpine AS builder
WORKDIR /workspace
USER app
SHELL ["/bin/sh", "-c"]
LABEL owner="team"
EXPOSE 8080
ENTRYPOINT ["/app/start"]
RUN echo alpha
RUN echo beta
RUN echo gamma
RUN echo before
RUN echo updated
RUN echo after
RUN echo delta
RUN echo epsilon
RUN echo zeta
"#;

    // Action: run the structural diff, context plugin and Rust pprint.
    let actual = pprint_diff("Dockerfile", before, after, 1);

    // Assertion
    assert_eq!(
        actual,
        r#"base/Dockerfile → head/Dockerfile — base → head
 base  head
              … base 1–10 / head 1–10 collapsed [fold_state_id=67] …
   11    11   RUN echo before
   12       - RUN echo previous
         12 + RUN echo updated
   13    13   RUN echo after
              … base 14–16 / head 14–16 collapsed [fold_state_id=69] …

[More context: set visibility.collapsed=false for the indicated fold_state_id
in the saved JSON, then run diffr pprint again. Full text and children are present.]
"#
    );
}
