#!/usr/bin/env bash

# Mtime freshness check shared by build.sh and run.sh. Returns 0 when the
# output is missing, a source is missing, or any source entry is newer.
# node_modules is pruned because code-oss-dependencies.sh owns dependency
# freshness through its digest stamp.
needs_rebuild() {
  if (( $# < 2 )); then
    echo "usage: needs_rebuild <output> <source>..." >&2
    return 2
  fi

  local output="$1"
  shift
  if [[ ! -f "$output" ]]; then
    return 0
  fi

  local source
  for source in "$@"; do
    if [[ ! -e "$source" ]]; then
      return 0
    fi
    if [[ -n "$(find "$source" -name node_modules -prune -o -newer "$output" -print -quit)" ]]; then
      return 0
    fi
  done
  return 1
}

# Rebuilds the Review server and the desktop canvas from source when their
# outputs are stale. Shared by build.sh's full-compile path and run.sh's
# launch freshness checks, so the pnpm builds and
# their staleness inputs are written once.
rebuild_review_desktop_outputs() {
  if (( $# != 2 )); then
    echo "usage: rebuild_review_desktop_outputs <monorepo-root> <review-package-dir>" >&2
    return 2
  fi

  local monorepo_root="$1"
  local review_package="$2"

  if needs_rebuild \
    "$review_package/dist/server/desktop-host.js" \
    "$review_package/src" \
    "$review_package/tsdown.config.ts" \
    "$review_package/package.json" \
    "$monorepo_root/packages/review-protocol/src"; then
    pnpm --dir "$monorepo_root" --filter @dev.fast/whiteboard build
  fi
  if needs_rebuild \
    "$review_package/app/dist/desktop/.vite/manifest.json" \
    "$review_package/app/src" \
    "$review_package/app/desktop.vite.config.ts" \
    "$review_package/app/package.json" \
    "$review_package/package.json" \
    "$monorepo_root/packages/review-protocol/src"; then
    pnpm --dir "$monorepo_root" --filter @dev.fast/review-canvas build
  fi
}
