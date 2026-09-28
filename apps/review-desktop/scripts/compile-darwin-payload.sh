#!/usr/bin/env bash
set -euo pipefail

# The macOS release is split: Linux produces this payload, and macOS consumes it.
# New packaged outputs must follow the "Linux-to-macOS build handoff" contract
# in apps/review-desktop/README.md.

MONOREPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
APP_DIR="$MONOREPO_ROOT/apps/review-desktop"
CHECKOUT="$APP_DIR/code-oss"
PAYLOAD="$APP_DIR/dist/darwin-payload.tar.zst"

# shellcheck source=darwin-payload-manifest.sh
source "$APP_DIR/scripts/darwin-payload-manifest.sh"

if (( $# > 0 )); then
  echo "usage: $0" >&2
  exit 2
fi

# The compile host is Linux, but curated extensions contain target-native
# servers. build.sh recompiles unconditionally, so run it once for the
# arm64 leg; the other Darwin targets are materialized directly below without
# repeating the compile.
REVIEW_DESKTOP_COMPILE_ONLY=1 \
  REVIEW_DESKTOP_CURATED_EXTENSION_TARGET=darwin-arm64 \
  bash "$APP_DIR/scripts/build.sh"

if git -C "$MONOREPO_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  BUILD_SOURCEVERSION="$(git -C "$MONOREPO_ROOT" rev-parse HEAD)"
else
  BUILD_SOURCEVERSION="$(jj --repository "$MONOREPO_ROOT" --ignore-working-copy log --no-graph -r @ -T 'commit_id')"
fi
export BUILD_SOURCEVERSION
# vscode-darwin-arm64-min-prepare produces the arch-independent out-vscode-min
# (codicons, non-native extensions, media, esbuild bundle; see
# gulpfile.vscode.ts:640-648). Both Darwin targets reuse this one output, so
# the task name stays arm64-specific even though it isn't arch-bound.
npm --prefix "$CHECKOUT" run gulp -- vscode-darwin-arm64-min-prepare

# Tags the bundles, so it must run before they are archived.
if [[ -n "${REVIEW_POSTHOG_KEY:-}" ]]; then
  node "$APP_DIR/scripts/upload-source-maps.mjs" --out "$CHECKOUT/out-vscode-min"
fi

for target in "${DARWIN_PAYLOAD_TARGETS[@]}"; do
  if [[ "$target" != "darwin-arm64" ]]; then
    # build.sh above only materialized curated extensions for darwin-arm64;
    # materialize the remaining targets without recompiling.
    node "$APP_DIR/scripts/curated-extensions.mjs" "--target=$target"
  fi

  target_payload="$MONOREPO_ROOT/$DARWIN_PAYLOAD_CURATED_EXTENSIONS_ROOT/$target"
  rm -rf -- "$target_payload"
  node "$APP_DIR/scripts/curated-extensions.mjs" \
    --target="$target" \
    --copy-to "$target_payload"
done

mkdir -p "$APP_DIR/dist"
rm -f -- "$PAYLOAD"
# Keep every Linux-built workspace output that pnpm deploy consumes in this
# payload. The precompiled macOS job disables lifecycle scripts, so it cannot
# rebuild a missing dist directory.
tar -cf - -C "$MONOREPO_ROOT" \
  "${DARWIN_PAYLOAD_ARCHIVE_ONLY_PATHS[@]}" \
  "${DARWIN_PAYLOAD_REQUIRED_PATHS[@]}" \
  | zstd -T0 -o "$PAYLOAD"

echo "Wrote $PAYLOAD"
