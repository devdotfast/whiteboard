default:
    @just --list

# Create a git tag and push it, to trigger a release on GitHub actions.
release:
    #!/bin/bash

    set -ex

    VERSION=$(cargo metadata --format-version=1 --no-deps | jq -r '.packages | .[] | select(.name == "difftastic") | .version')
    git tag $VERSION
    git push origin $VERSION

# Run perf stat on baseline test files and save results.
perf:
    #!/bin/bash
    set -e

    cargo build --release

    TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
    OUTFILE="perf_baseline_${TIMESTAMP}.txt"

    echo '$ perf stat ./target/release/diffr sample_files/typing_1.ml sample_files/typing_2.ml >/dev/null' >> "$OUTFILE"
    perf stat ./target/release/diffr sample_files/typing_1.ml sample_files/typing_2.ml >/dev/null 2>> "$OUTFILE"

    echo '$ perf stat ./target/release/diffr sample_files/slow_1.rs sample_files/slow_2.rs >/dev/null' >> "$OUTFILE"
    perf stat ./target/release/diffr sample_files/slow_1.rs sample_files/slow_2.rs >/dev/null 2>> "$OUTFILE"

    echo "Results written to $OUTFILE"
