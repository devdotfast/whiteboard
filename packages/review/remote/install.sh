#!/bin/sh
# Installs Whiteboard's remote CLI on a Linux host. Desktop pipes this file over ssh;
# the same file is published next to each release's tarballs for hand installs:
#   curl -fsSL https://install.dev.fast/releases/<version>/remote/install.sh | sh -s -- --version <version>
#
#   install --version V [--sha256 H (--url U | --file F)] [--downloader curl|wget] [--owner NAME] [--token HEX]
#           [--lock-wait S] [--lock-poll S] [--lock-stale S]   (the default command)
#   probe [--releases URL]     prints what Desktop needs to judge the host; writes nothing
#   release --token HEX        drops the install lock if that install still holds it
#   uninstall                  runs the newest installed version's `whiteboard remote uninstall`
#
# Older and newer Desktops and `whiteboard remote uninstall` share this layout; change it
# only with a migration:
#   $root/versions/<v>/        one version, complete once .whiteboard-install.json names
#                              its sha256, an executable node and its cli
#   $root/install.lock/        token, owner and started (epoch seconds); stale after 15 minutes
#   ~/.local/bin/whiteboard    launcher for the newest version, replaced only when it carries
#                              the mark below or is the old hand-install symlink
# $root is $DEV_REVIEW_HOME/whiteboard-remote, or ~/.dev/whiteboard-remote.
# Desktop reads stdout lines "WHITEBOARD-INSTALL <WORD> <value>".

LC_ALL=C
export LC_ALL
umask 022
trap '' PIPE
exec 3>&1

MARKER=.whiteboard-install.json
MARK='# Written by Whiteboard Desktop, which replaces it with each install.'
RELEASES=${WHITEBOARD_RELEASES:-https://install.dev.fast/releases}
hand=

say() { [ -n "$hand" ] || printf '\n%s %s\n' WHITEBOARD-INSTALL "$*" >&3; }
tell() { [ -z "$hand" ] || printf '%s\n' "$*" >&2; }
fail() {
	say FAIL "$*"
	tell "Whiteboard was not installed: $*"
	exit 3
}
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

base=$(printf '%s' "${DEV_REVIEW_HOME-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
root=
case "$base" in
'') root=$HOME/.dev/whiteboard-remote ;;
*//* | */./* | */../* | */. | */..) ;;
/*) root=${base%/}/whiteboard-remote ;;
esac
[ "$(printf '%s' "${DEV_REVIEW_HOME-}" | tr -d '\001-\037\177')" = "${DEV_REVIEW_HOME-}" ] || root=
lock=$root/install.lock

completeSha256() {
	cs=$(sed -n 's/.*"sha256":"\([^"][^"]*\)".*/\1/p' "$1" 2>/dev/null)
	cn=$(sed -n 's/.*"node":"\([^"]*\)".*/\1/p' "$1" 2>/dev/null)
	cc=$(sed -n 's/.*"cli":"\([^"]*\)".*/\1/p' "$1" 2>/dev/null)
	[ -n "$cs" ] && [ -x "$cn" ] && [ -f "$cc" ] && printf '%s' "$cs"
}

# Semver precedence, newest first.
newestFirst() {
	awk '
	function core(v, i) { i = index(v, "-"); return i ? substr(v, 1, i - 1) : v }
	function pre(v, i) { i = index(v, "-"); return i ? substr(v, i + 1) : "" }
	function cmp(a, b, x, y, n, m, i, p, r, nx, ny) {
		split(core(a), x, "."); split(core(b), y, ".")
		for (i = 1; i <= 3; i++) if (x[i] + 0 != y[i] + 0) return x[i] + 0 < y[i] + 0 ? -1 : 1
		p = pre(a); r = pre(b)
		if (p == "" || r == "") return p == r ? 0 : (p == "" ? 1 : -1)
		n = split(p, x, "."); m = split(r, y, ".")
		for (i = 1; i <= n && i <= m; i++) {
			if (x[i] == y[i]) continue
			nx = x[i] ~ /^[0-9]+$/; ny = y[i] ~ /^[0-9]+$/
			if (nx && ny) return x[i] + 0 < y[i] + 0 ? -1 : 1
			if (nx != ny) return nx ? -1 : 1
			return x[i] < y[i] ? -1 : 1
		}
		return n == m ? 0 : (n < m ? -1 : 1)
	}
	NF { v[++c] = $0; for (j = c; j > 1 && cmp(v[j], v[j - 1]) > 0; j--) { t = v[j]; v[j] = v[j - 1]; v[j - 1] = t } }
	END { for (j = 1; j <= c; j++) print v[j] }'
}

bounded() {
	if timeout -k 1 1 true >/dev/null 2>&1; then timeout -k 1 "$@"; else shift; "$@"; fi
}

probe() {
	releases=
	while [ $# -gt 0 ]; do
		case "$1" in
		--releases) releases=$2; shift 2 ;;
		*) shift ;;
		esac
	done
	str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
	strOrNull() { if [ -n "$1" ]; then str "$1"; else printf null; fi; }
	os=$(uname -s 2>/dev/null)
	arch=$(uname -m 2>/dev/null)
	glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | sed -n 's/^glibc \([0-9][0-9.]*\)$/\1/p')
	if [ -z "$glibc" ]; then
		glibc=$(ldd --version 2>&1 | head -n 1 | grep -i -e glibc -e 'gnu libc' | sed -n 's/.* \([0-9][0-9]*\.[0-9][0-9]*\)$/\1/p')
	fi
	writable=false
	[ -d "$HOME" ] && [ -w "$HOME" ] && writable=true
	free=$(df -Pk "$HOME" 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 * 1024 }')
	installed=
	for dir in "$root"/versions/*; do
		[ -d "$dir" ] || continue
		case "$dir" in *.part) continue ;; esac
		sha256=$(completeSha256 "$dir/$MARKER")
		[ -n "$sha256" ] || continue
		installed="$installed${installed:+,}{\"version\":$(str "${dir##*/}"),\"sha256\":$(str "$sha256")}"
	done
	tools=
	for tool in tar xz sha256sum openssl; do
		command -v "$tool" >/dev/null 2>&1 && tools="$tools${tools:+,}\"$tool\""
	done
	downloader=
	reachable=false
	if command -v curl >/dev/null 2>&1; then
		downloader=curl
		[ -n "$releases" ] && curl -fsI --max-time 3 -o /dev/null "$releases" >/dev/null 2>&1 && reachable=true
	elif command -v wget >/dev/null 2>&1; then
		downloader=wget
		hsts=
		tries=
		wget --help 2>&1 | grep -q -- --no-hsts && hsts=--no-hsts
		wget --help 2>&1 | grep -q -- --tries && tries="-t 1"
		limit=
		command -v timeout >/dev/null 2>&1 && limit="timeout 3"
		# shellcheck disable=SC2086 # empty options must vanish
		[ -n "$releases" ] && $limit wget -q $hsts $tries -T 3 --spider "$releases" >/dev/null 2>&1 && reachable=true
	fi
	echo
	echo WHITEBOARD-PROBE-BEGIN
	printf '{"os":%s,"arch":%s,"glibc":%s,"home":%s,"root":%s,"homeWritable":%s,"freeBytes":%s,' \
		"$(str "$os")" "$(str "$arch")" "$(strOrNull "$glibc")" "$(str "$HOME")" "$(str "$root")" \
		"$writable" "${free:-0}"
	printf '"installed":[%s],"downloader":%s,"releasesReachable":%s,"tools":[%s]}\n' \
		"$installed" "$(strOrNull "$downloader")" "$reachable" "$tools"
	echo WHITEBOARD-PROBE-END

	# The same lookup as Desktop's attach script.
	wb=$(command -v whiteboard 2>/dev/null)
	case "$wb" in /*) ;; *) wb= ;; esac
	if [ -z "$wb" ] && [ -x "$HOME/.local/bin/whiteboard" ]; then wb="$HOME/.local/bin/whiteboard"; fi
	if [ -z "$wb" ] && [ -n "$SHELL" ]; then
		wb=$(bounded 3 "$SHELL" -lic 'command -v whiteboard' </dev/null 2>/dev/null | tr -d '\r' | grep '^/.*/whiteboard$' | tail -n 1)
	fi
	[ -n "$wb" ] && [ -x "$wb" ] || wb=
	# Desktop's own installs are judged by their markers, not by a version on PATH.
	grep -qxF "$MARK" "$wb" 2>/dev/null && wb=
	case "$(readlink -f "$wb" 2>/dev/null)" in "$(readlink -f "$root" 2>/dev/null || echo "$root")"/versions/*) wb= ;; esac
	if [ -n "$wb" ]; then
		wbVersion=$(PATH="${wb%/*}:$PATH" DEV_FAST_REVIEW_CLI_NO_DELEGATE=1 DEV_FAST_REVIEW_TELEMETRY_DISABLED=1 bounded 2 "$wb" --version </dev/null 2>/dev/null | head -n 1)
		printf '%s {"path":%s,"version":%s}\n' WHITEBOARD-PROBE-PATH-CLI "$(str "$wb")" "$(strOrNull "$wbVersion")"
	fi
}

# A rename, so a reader never sees "started" half written.
stamp() { date +%s >"$lock/started.$token" && mv -f "$lock/started.$token" "$lock/started"; }
own() {
	[ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] || fail this install no longer holds the install lock
	stamp
}
release() {
	if [ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] && mv "$lock" "$lock.$token.done" 2>/dev/null; then
		rm -rf "$lock.$token.done"
	fi
}
# Runs a long step, keeping the lock fresh; a heartbeat that cannot be written means Desktop
# went away, so the step is stopped.
guard() {
	if command -v setsid >/dev/null 2>&1; then setsid "$@" & else "$@" & fi
	pid=$!
	while kill -0 "$pid" 2>/dev/null; do
		printf '.\n' >&3 2>/dev/null || {
			kill -TERM -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null
			exit 3
		}
		[ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] && stamp
		sleep 1
	done
	wait "$pid"
}

# 0 when this install took the lock, 1 when another holds it.
takeLock() {
	if mkdir "$lock" 2>/dev/null; then
		printf '%s\n' "$token" >"$lock/token"
		printf '%s\n' "$owner" >"$lock/owner"
		stamp
		return 0
	fi
	# The token first: a takeover completed between the two reads leaves "started" fresh.
	held=$(cat "$lock/token" 2>/dev/null)
	started=$(cat "$lock/started" 2>/dev/null)
	case "$started" in
	'' | *[!0-9]*)
		# Never written (a holder that died right after mkdir): by the directory's age. Unreadable: fresh.
		if [ ! -e "$lock/started" ] && [ -n "$(find "$lock" -prune -mmin +"$(((lockStale + 59) / 60))" 2>/dev/null)" ]; then started=0; else started=$(date +%s); fi
		;;
	esac
	[ $(($(date +%s) - started)) -ge "$lockStale" ] || return 1
	stale="$lock.$token.stale"
	if mv "$lock" "$stale" 2>/dev/null; then
		# Another install may have taken it over first: give that one back.
		if [ "$(cat "$stale/token" 2>/dev/null)" = "$held" ] || [ -e "$lock" ]; then rm -rf "$stale"; else mv "$stale" "$lock"; fi
	fi
	mkdir "$lock" 2>/dev/null || return 1
	printf '%s\n' "$token" >"$lock/token"
	printf '%s\n' "$owner" >"$lock/owner"
	stamp
}

fetch() {
	if [ "$downloader" = curl ]; then
		guard curl -fsSL --connect-timeout 20 --max-time 900 -o "$2" "$1"
	else
		hsts=
		wget --help 2>&1 | grep -q -- --no-hsts && hsts=--no-hsts
		limit=
		command -v timeout >/dev/null 2>&1 && limit="timeout 900"
		# shellcheck disable=SC2086 # empty options must vanish
		guard $limit wget -q $hsts -t 2 -T 30 -O "$2" "$1"
	fi
}

install() {
	downloader=
	version=
	sha256=
	url=
	file=
	owner=
	token=
	lockWait=900
	lockPoll=2
	lockStale=900
	while [ $# -gt 0 ]; do
		case "$1" in
		--version) version=$2 ;;
		--sha256) sha256=$2 ;;
		--url) url=$2 ;;
		--file) file=$2 ;;
		--downloader) downloader=$2 ;;
		--owner) owner=$2 ;;
		--token) token=$2 ;;
		--lock-wait) lockWait=$2 ;;
		--lock-poll) lockPoll=$2 ;;
		--lock-stale) lockStale=$2 ;;
		*) fail "unknown option $1" ;;
		esac
		shift 2
	done
	[ -n "$url$file" ] || hand=1
	printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' || fail "--version needs a version such as 1.2.3, not \"$version\""
	[ -n "$root" ] || fail DEV_REVIEW_HOME is not an absolute, normalised path
	case "$root" in *[\"\\]*) fail "$root holds a quote or backslash" ;; esac
	[ -n "$token" ] || token=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
	printf '%s\n' "$token" | grep -Eqx '[0-9a-f]{8,64}' || fail the install token is not hex
	[ -n "$owner" ] || owner=$(hostname 2>/dev/null || echo unknown)

	[ -n "$downloader" ] || ! command -v curl >/dev/null 2>&1 || downloader=curl
	[ -n "$downloader" ] || ! command -v wget >/dev/null 2>&1 || downloader=wget
	case "$downloader" in '' | curl | wget) ;; *) fail "--downloader is curl or wget, not $downloader" ;; esac
	if [ -n "$hand" ]; then
		[ "$(uname -s)" = Linux ] || fail "this host runs $(uname -s); Whiteboard needs Linux"
		case "$(uname -m)" in
		x86_64) target=linux-x64 ;;
		aarch64) target=linux-arm64 ;;
		*) fail "this host's CPU is $(uname -m); Whiteboard needs x86_64 or aarch64" ;;
		esac
		[ -n "$downloader" ] || fail Whiteboard needs curl or wget
		url="$RELEASES/$version/remote/whiteboard-remote-$version-$target.tar.xz"
		if [ "$downloader" = curl ]; then sha256=$(curl -fsSL "$url.sha256"); else sha256=$(wget -qO- "$url.sha256"); fi
		sha256=${sha256%% *}
	fi
	printf '%s\n' "$sha256" | grep -Eqx '[0-9a-f]{64}' || fail "no sha256 for $version"

	v=$root/versions/$version
	m=$v/$MARKER
	if [ "$(completeSha256 "$m")" = "$sha256" ]; then
		say DONE "$(cat "$m")"
		tell "Whiteboard $version is already installed."
		exit 0
	fi
	[ -n "$file$downloader" ] || fail Whiteboard needs curl or wget

	mkdir -p "$root" || fail cannot create "$root"
	polls=$(awk -v w="$lockWait" -v p="$lockPoll" 'BEGIN { n = w / p; printf "%d", (n == int(n) ? n : int(n) + 1) }')
	told=
	while ! takeLock; do
		if [ "$polls" -le 0 ]; then
			say BUSY "$(cat "$lock/owner" 2>/dev/null)"
			tell "Another install ($(cat "$lock/owner" 2>/dev/null)) holds $lock."
			exit 5
		fi
		[ -n "$told" ] || say STEP waiting-for-lock
		told=1
		polls=$((polls - 1))
		sleep "$lockPoll"
	done
	trap release EXIT
	trap 'exit 3' HUP INT TERM

	rm -rf "$root"/versions/*.part "$lock".*.stale "$lock".*.done
	mkdir -p "$root/versions" || fail cannot create "$root/versions"
	if [ "$(completeSha256 "$m")" = "$sha256" ]; then
		say DONE "$(cat "$m")"
		exit 0
	fi
	p=$v.$token.part
	if [ -e "$v" ] && ! { mv "$v" "$p" && rm -rf "$p"; }; then fail cannot remove "$v"; fi
	have=
	for dir in "$root"/versions/*; do
		[ -n "$(completeSha256 "$dir/$MARKER")" ] && have="$have${dir##*/}
" && continue
		# A version whose removal was cut short (its marker went first).
		case "${dir##*/}" in [0-9]*.[0-9]*.[0-9]*) rm -rf "$dir" ;; esac
	done
	mkdir "$p" || fail cannot create "$p"

	say STEP package
	tell "Installing Whiteboard $version in $v"
	f=$p/whiteboard-remote.tar.xz
	if [ -n "$file" ]; then
		cp "$file" "$f" || fail cannot read "$file"
	else
		own
		fetch "$url" "$f" || {
			s=$?
			rm -rf "$p"
			fail cannot download "$url": "$downloader" exited with "$s"
		}
	fi
	sum=$(sha256sum "$f" 2>/dev/null || openssl dgst -sha256 -r "$f" 2>/dev/null)
	sum=${sum%% *}
	if [ "$sum" != "$sha256" ]; then
		rm -rf "$p"
		say MISMATCH "$sum"
		tell "The tarball does not match its checksum; it was removed."
		exit 4
	fi
	own
	guard tar -xJf "$f" -C "$p" --strip-components=1 || {
		rm -rf "$p"
		fail cannot unpack the tarball
	}
	rm -f "$f"
	[ -x "$p/bin/node" ] && [ -f "$p/dist/cli.js" ] && [ -x "$p/whiteboard" ] || {
		rm -rf "$p"
		fail the tarball holds no whiteboard
	}
	out=$(DEV_FAST_REVIEW_CLI_NO_DELEGATE=1 DEV_FAST_REVIEW_TELEMETRY_DISABLED=1 "$p/bin/node" "$p/dist/cli.js" version --json </dev/null 2>/dev/null | tail -n 1)
	reported=$(printf '%s' "$out" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
	[ "$reported" = "$version" ] || {
		rm -rf "$p"
		fail "the tarball reports version ${reported:-nothing}, not $version"
	}

	own
	printf '{"version":"%s","sha256":"%s","node":"%s","cli":"%s","installedAt":%s}\n' \
		"$version" "$sha256" "$v/bin/node" "$v/dist/cli.js" "$(date +%s)" >"$p/$MARKER" || fail cannot write the marker
	[ -e "$v" ] && {
		rm -rf "$p"
		fail "$v appeared during the install"
	}
	mv "$p" "$v" || fail cannot move the version into place

	newest=$(printf '%s%s\n' "$have" "$version" | newestFirst | head -n 1)
	if [ "$newest" = "$version" ]; then
		w=$HOME/.local/bin/whiteboard
		old=$root/whiteboard-remote
		adopt=
		[ -L "$w" ] && [ "$(readlink "$w")" = "$old/whiteboard" ] && adopt=1
		if [ -n "$adopt" ] || { [ ! -e "$w" ] && [ ! -L "$w" ]; } || { [ -f "$w" ] && [ ! -L "$w" ] && grep -qxF "$MARK" "$w"; }; then
			if mkdir -p "${w%/*}" && printf '#!/bin/sh\n%s\nexec %s "$@"\n' "$MARK" "$(q "$v/whiteboard")" >"$w.$token.part" && chmod 755 "$w.$token.part" && mv -f "$w.$token.part" "$w"; then
				say LAUNCHER written
				tell "Linked $w"
			else
				rm -f "$w.$token.part"
				say LAUNCHER failed
			fi
		else
			say LAUNCHER foreign
			tell "Left $w alone: Whiteboard did not write it. Run $v/whiteboard, or put it on your PATH."
		fi
	fi

	# Read once so a grep below never finds itself; launchers run the CLI by absolute path.
	if [ -d /proc/self ]; then
		procs=$(for f in /proc/[0-9]*/cmdline; do tr '\000' ' ' <"$f" 2>/dev/null; echo; done)
	else
		procs=$(ps -eo args= 2>/dev/null)
	fi
	running() { printf '%s\n' "$procs" | grep -qF -- "$1/"; }
	[ -n "$adopt" ] && ! running "$old" && rm -rf "$old"
	room=1
	[ "$newest" = "$version" ] || room=0
	candidates=$(printf '%s' "$have" | grep -vxF -e "$version" -e "$newest" | newestFirst)
	kept=0
	for c in $candidates; do running "$root/versions/$c" && kept=$((kept + 1)); done
	for c in $candidates; do
		if running "$root/versions/$c"; then
			say IN-USE "$c"
			continue
		fi
		if [ "$kept" -lt "$room" ]; then
			kept=$((kept + 1))
			continue
		fi
		d=$root/versions/$c
		[ -f "$d/$MARKER" ] || continue
		rm -f "$d/$MARKER" && rm -rf "$d" && say REMOVED "$c"
	done

	say DONE "$(cat "$m")"
	tell "Whiteboard $version is installed. Run: whiteboard --version"
}

uninstall() {
	[ -n "$root" ] || fail DEV_REVIEW_HOME there is not an absolute, normalised path
	newest=$(for dir in "$root"/versions/*; do [ -n "$(completeSha256 "$dir/$MARKER")" ] && printf '%s\n' "${dir##*/}"; done |
		grep -Ex '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | newestFirst | head -n 1)
	[ -n "$newest" ] || fail Whiteboard Desktop installed nothing there
	completeSha256 "$root/versions/$newest/$MARKER" >/dev/null
	DEV_FAST_REVIEW_CLI_NO_DELEGATE=1 exec "$cn" "$cc" remote uninstall --keep-reviews --json </dev/null
}

case "${1-}" in
probe) shift && probe "$@" ;;
uninstall) uninstall ;;
release)
	token=${3-}
	release
	;;
install) shift && install "$@" ;;
*) install "$@" ;;
esac
