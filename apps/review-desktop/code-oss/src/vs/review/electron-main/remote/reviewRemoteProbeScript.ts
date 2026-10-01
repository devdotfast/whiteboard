/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_REMOTE_INSTALL_MARKER } from "./reviewRemoteInstallScript.js";

export const REVIEW_REMOTE_PROBE_BEGIN = "WHITEBOARD-PROBE-BEGIN";
export const REVIEW_REMOTE_PROBE_END = "WHITEBOARD-PROBE-END";

/**
 * POSIX sh and coreutils, sent to `sh -s` on the remote. Prints one JSON line
 * between the sentinels and writes nothing: no temporary files, no login
 * shell (it could write history), and wget only with `--no-hsts`. The
 * registry check has its own 3 s limit; the caller bounds the whole run.
 *
 * Node 24 is looked for on PATH, in /usr/local/bin and /usr/bin, and under
 * nvm, fnm, volta, asdf, mise, nodenv and n; each candidate is run once for
 * its version, and the highest 24.x wins. A version is listed, with the
 * integrity its marker names, only when the marker names one.
 */
export const REVIEW_REMOTE_PROBE_SCRIPT = `LC_ALL=C
export LC_ALL
str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\\000-\\037' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"; }
strOrNull() { if [ -n "$1" ]; then str "$1"; else printf null; fi; }

os=$(uname -s 2>/dev/null)
arch=$(uname -m 2>/dev/null)
glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | sed -n 's/^glibc \\([0-9][0-9.]*\\)$/\\1/p')
if [ -z "$glibc" ]; then
	glibc=$(ldd --version 2>&1 | head -n 1 | grep -i -e glibc -e 'gnu libc' | sed -n 's/.* \\([0-9][0-9]*\\.[0-9][0-9]*\\)$/\\1/p')
fi
home=$HOME
writable=false
[ -d "$home" ] && [ -w "$home" ] && writable=true
free=$(df -Pk "$home" 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 * 1024 }')

# The highest 24.x among the candidates in $@: sets best and bestVersion.
best=
bestVersion=
pick() {
	for candidate in "$@"; do
		[ -f "$candidate" ] && [ -x "$candidate" ] || continue
		version=$("$candidate" --version 2>/dev/null </dev/null | head -n 1)
		case "$version" in v24.*) ;; *) continue ;; esac
		version=\${version#v}
		minor=\${version#24.}; minor=\${minor%%.*}
		patch=\${version##*.}
		case "$minor$patch" in *[!0-9]*|'') continue ;; esac
		if [ -n "$bestVersion" ]; then
			bestMinor=\${bestVersion#24.}; bestMinor=\${bestMinor%%.*}
			bestPatch=\${bestVersion##*.}
			[ "$minor" -gt "$bestMinor" ] || { [ "$minor" -eq "$bestMinor" ] && [ "$patch" -gt "$bestPatch" ]; } || continue
		fi
		best=$candidate
		bestVersion=$version
	done
}

pick "$(command -v node 2>/dev/null)" /usr/local/bin/node /usr/bin/node \\
	"\${NVM_DIR:-$home/.nvm}"/versions/node/v24*/bin/node \\
	"\${FNM_DIR:-$home/.local/share/fnm}"/node-versions/v24*/installation/bin/node \\
	"$home"/.fnm/node-versions/v24*/installation/bin/node \\
	"\${VOLTA_HOME:-$home/.volta}"/tools/image/node/24*/bin/node \\
	"\${ASDF_DATA_DIR:-$home/.asdf}"/installs/nodejs/24*/bin/node \\
	"$home"/.local/share/mise/installs/node/24*/bin/node \\
	"$home"/.nodenv/versions/24*/bin/node \\
	"\${N_PREFIX:-/usr/local}"/n/versions/node/24*/bin/node
node=$best
nodeVersion=$bestVersion
npm=
[ -n "$node" ] && [ -x "\${node%/*}/npm" ] && npm=\${node%/*}/npm

remote=$home/.dev/whiteboard-remote
best=
bestVersion=
pick "$remote"/node/v24*/bin/node
managed=$best

installed=
for dir in "$remote"/versions/*; do
	[ -d "$dir" ] || continue
	case "$dir" in *.part) continue ;; esac
	integrity=$(sed -n 's/.*"integrity":"\\([^"][^"]*\\)".*/\\1/p' "$dir/${REVIEW_REMOTE_INSTALL_MARKER}" 2>/dev/null)
	[ -n "$integrity" ] || continue
	installed="$installed\${installed:+,}{\\"version\\":$(str "\${dir##*/}"),\\"integrity\\":$(str "$integrity")}"
done

tools=
for tool in tar xz sha256sum sha512sum openssl; do
	command -v "$tool" >/dev/null 2>&1 && tools="$tools\${tools:+,}\\"$tool\\""
done

registry=https://registry.npmjs.org/
downloader=
reachable=false
if command -v curl >/dev/null 2>&1; then
	downloader=curl
	curl -fsI --max-time 3 -o /dev/null "$registry" >/dev/null 2>&1 && reachable=true
elif command -v wget >/dev/null 2>&1; then
	downloader=wget
	hsts=
	tries=
	wget --help 2>&1 | grep -q -- --no-hsts && hsts=--no-hsts
	wget --help 2>&1 | grep -q -- --tries && tries="-t 1"
	limit=
	command -v timeout >/dev/null 2>&1 && limit="timeout 3"
	$limit wget -q $hsts $tries -T 3 --spider "$registry" >/dev/null 2>&1 && reachable=true
fi

echo
echo ${REVIEW_REMOTE_PROBE_BEGIN}
printf '{"os":%s,"arch":%s,"glibc":%s,"home":%s,"homeWritable":%s,"freeBytes":%s,' \\
	"$(str "$os")" "$(str "$arch")" "$(strOrNull "$glibc")" "$(str "$home")" \\
	"$writable" "\${free:-0}"
if [ -n "$node" ]; then
	printf '"node":{"path":%s,"version":%s},' "$(str "$node")" "$(str "$nodeVersion")"
else
	printf '"node":null,'
fi
printf '"npm":%s,"installed":[%s],"managedNode":%s,"downloader":%s,"registryReachable":%s,"tools":[%s]}\\n' \\
	"$(strOrNull "$npm")" "$installed" "$(strOrNull "$managed")" "$(strOrNull "$downloader")" "$reachable" "$tools"
echo ${REVIEW_REMOTE_PROBE_END}
`;
