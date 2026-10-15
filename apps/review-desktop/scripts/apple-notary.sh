#!/usr/bin/env bash
set -euo pipefail

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/whiteboard-apple-notary.XXXXXX")"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT

stdout="$TEMP_ROOT/stdout"
stderr="$TEMP_ROOT/stderr"
transient='NSURLErrorDomain Code=-(1001|1003|1004|1005|1006|1009)([^0-9]|$)|HTTP status code: (408|429|500|502|503|504)([^0-9]|$)|statusCode: Optional\((408|429|500|502|503|504)\)'

for attempt in 1 2 3 4 5; do
  if xcrun "$@" >"$stdout" 2>"$stderr"; then
    cat "$stderr" >&2
    cat "$stdout"
    exit 0
  else
    status=$?
  fi
  # Keep failed diagnostics out of the successful notarytool JSON response.
  cat "$stdout" "$stderr" >&2
  # stapler is idempotent and runs only after Apple accepted the submission, so
  # its failures are ticket-service flakes; notarytool submit is not idempotent.
  if [[ "$attempt" == 5 ]] || ! {
    [[ "$1" == stapler || "$status" == 75 ]] ||
      grep -Eq "$transient" "$stdout" "$stderr"
  }; then
    exit "$status"
  fi
  delay=$((5 * (1 << (attempt - 1))))
  echo "Apple $1 $2 failed transiently (exit $status); retrying in ${delay}s ($attempt/5)." >&2
  sleep "$delay"
done
