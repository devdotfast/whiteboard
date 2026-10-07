#!/bin/sh
# Print a diffr comparison as text, using the TUI's own row model.
#   ./pprint.sh <base> <head> [-- <path>...] [--open id,id] [--width N] [--mock-summaries]
# --open opens the folds with those ids (shown as ▸[id]). --mock-summaries
# turns the summarizer on against a local stand-in for Gemini that answers
# with canned "[mock]" pseudocode.
set -e
root=$(cd "$(dirname "$0")" && pwd)
diff_args=""
view_args=""
mock=""
while [ $# -gt 0 ]; do
  case "$1" in
    --open|--width) view_args="$view_args $1 $2"; shift 2 ;;
    --mock-summaries) mock=1; shift ;;
    *) diff_args="$diff_args $1"; shift ;;
  esac
done
work=$(mktemp -d)
server=""
stop() {
  status=$?
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null
    wait "$server" 2>/dev/null || true
  fi
  rm -rf "$work"
  exit "$status"
}
trap stop EXIT
if [ -n "$mock" ]; then
  port=8766
  python3 "$root/scripts/mock_gemini.py" "$port" &
  server=$!
  mkdir -p "$work/config/diffr"
  cat > "$work/config/diffr/config.toml" <<TOML
version = 2

[plugins.shape.bundled.summarize]
enabled = true
api_key = "mock"
endpoint = "http://127.0.0.1:$port"
min_lines = 8
test_min_lines = 8
TOML
  sleep 0.5
  XDG_CONFIG_HOME="$work/config" "$root/target/debug/diffr" --format ndjson $diff_args > "$work/stream.ndjson"
else
  "$root/target/debug/diffr" --format ndjson $diff_args > "$work/stream.ndjson"
fi
cd "$root/tui" && bun ../scripts/pprint.ts "$work/stream.ndjson" $view_args
