/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { REVIEW_REMOTE_WRAPPER_MARK } from "../../common/reviewProtocol.js";

export { REVIEW_REMOTE_WRAPPER_MARK };

export const REVIEW_REMOTE_INSTALL_SAY = "WHITEBOARD-INSTALL";
export const REVIEW_REMOTE_INSTALL_MARKER = ".whiteboard-install.json";
export const REVIEW_REMOTE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const REVIEW_REMOTE_LOCK_STALE_SECONDS = 15 * 60;

export function shellQuote(value: string, lines = false): string {
	if ((lines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(value)) {
		throw new Error(`${JSON.stringify(value)} holds a control character.`);
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ReviewRemoteInstallContext {
	readonly home: string;
	readonly token: string;
}

export const reviewRemoteRoot = (home: string) => `${home}/.dev/whiteboard-remote`;
export const reviewRemoteVersionDir = (home: string, version: string) => `${reviewRemoteRoot(home)}/versions/${version}`;
export const reviewRemoteNodeDir = (home: string, nodeVersion: string) => `${reviewRemoteRoot(home)}/node/v${nodeVersion}`;
export const reviewRemoteWrapperPath = (home: string) => `${home}/.local/bin/whiteboard`;

const versionPart = (context: ReviewRemoteInstallContext, version: string) => `${reviewRemoteVersionDir(context.home, version)}.${context.token}.part`;
const nodePart = (context: ReviewRemoteInstallContext, nodeVersion: string) => `${reviewRemoteNodeDir(context.home, nodeVersion)}.${context.token}.part`;

function prelude(context: ReviewRemoteInstallContext): string {
	if (!/^[0-9a-f]{8,64}$/.test(context.token)) throw new Error("The install token is not hex.");
	return `LC_ALL=C
export LC_ALL
umask 022
trap '' PIPE
exec 3>&1
root=${shellQuote(reviewRemoteRoot(context.home))}
lock="$root/install.lock"
token=${context.token}
say() { printf '\\n%s %s\\n' ${REVIEW_REMOTE_INSTALL_SAY} "$*" >&3; }
fail() { say FAIL "$*"; exit 3; }
# A rename, so a reader never sees "started" half written.
stamp() { date +%s > "$lock/started.$token" && mv -f "$lock/started.$token" "$lock/started"; }
own() {
	[ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] || fail this install no longer holds the install lock
	stamp
}
guard() {
	if command -v setsid >/dev/null 2>&1; then setsid "$@" & else "$@" & fi
	pid=$!
	while kill -0 "$pid" 2>/dev/null; do
		printf '.\\n' >&3 2>/dev/null || { kill -TERM -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null; exit 3; }
		[ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] && stamp
		sleep 1
	done
	wait "$pid"
}
`;
}

export function lockScript(context: ReviewRemoteInstallContext, owner: string, staleSeconds = REVIEW_REMOTE_LOCK_STALE_SECONDS): string {
	const staleMinutes = Math.ceil(staleSeconds / 60);
	return `${prelude(context)}mkdir -p "$root" || fail cannot create "$root"
take() {
	mkdir "$lock" 2>/dev/null || return 1
	printf '%s\\n' "$token" > "$lock/token"
	printf '%s\\n' ${shellQuote(owner)} > "$lock/owner"
	stamp
	say LOCKED
	exit 0
}
take
# The token first: a takeover completed between the two reads leaves "started" fresh.
held=$(cat "$lock/token" 2>/dev/null)
started=$(cat "$lock/started" 2>/dev/null)
case "$started" in
''|*[!0-9]*)
	# Never written (a holder that died right after mkdir): by the directory's age. Unreadable: fresh.
	if [ ! -e "$lock/started" ] && [ -n "$(find "$lock" -prune -mmin +${staleMinutes} 2>/dev/null)" ]; then started=0; else started=$(date +%s); fi ;;
esac
if [ $(( $(date +%s) - started )) -ge ${staleSeconds} ]; then
	stale="$root/install.lock.$token.stale"
	if mv "$lock" "$stale" 2>/dev/null; then
		# Another install may have taken it over first: give that one back.
		if [ "$(cat "$stale/token" 2>/dev/null)" = "$held" ] || [ -e "$lock" ]; then rm -rf "$stale"; else mv "$stale" "$lock"; fi
	fi
	take
fi
say BUSY "$(cat "$lock/owner" 2>/dev/null)"
`;
}

export function refreshScript(context: ReviewRemoteInstallContext): string {
	return `${prelude(context)}own
say REFRESHED
`;
}

export function releaseScript(context: ReviewRemoteInstallContext): string {
	return `${prelude(context)}if [ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] && mv "$lock" "$root/install.lock.$token.done" 2>/dev/null; then
	rm -rf "$root/install.lock.$token.done"
fi
say RELEASED
`;
}

export function prepareScript(context: ReviewRemoteInstallContext, input: { version: string; integrity: string; nodeVersion: string }): string {
	const nodeDir = reviewRemoteNodeDir(context.home, input.nodeVersion);
	return `${prelude(context)}own
rm -rf "$root"/versions/*.part "$root"/node/*.part "$root"/install.lock.*.stale "$root"/install.lock.*.done
mkdir -p "$root/versions" || fail cannot create "$root/versions"
${markerCheck(context, input)}
if [ -n "$complete" ]; then
	say COMPLETE
	say MARKER "$(cat "$m")"
elif [ -e "$v" ]; then
	mv "$v" ${shellQuote(versionPart(context, input.version))} && rm -rf ${shellQuote(versionPart(context, input.version))} || fail cannot remove "$v"
fi
for dir in "$root"/versions/*; do
	[ -f "$dir/${REVIEW_REMOTE_INSTALL_MARKER}" ] && say HAVE "\${dir##*/}" && continue
	# A version whose removal was cut short: its marker went first.
	case "\${dir##*/}" in [0-9]*.[0-9]*.[0-9]*) rm -rf "$dir" ;; esac
done
n=${shellQuote(`${nodeDir}/bin/node`)}
[ -x "$n" ] && [ "$("$n" --version 2>/dev/null)" = v${input.nodeVersion} ] && say MANAGED-NODE
say PREPARED
`;
}

export const REVIEW_REMOTE_COMPLETE_INTEGRITY = `completeIntegrity() {
	ci=$(sed -n 's/.*"integrity":"\\([^"][^"]*\\)".*/\\1/p' "$1" 2>/dev/null)
	cn=$(sed -n 's/.*"node":"\\([^"]*\\)".*/\\1/p' "$1" 2>/dev/null)
	cc=$(sed -n 's/.*"cli":"\\([^"]*\\)".*/\\1/p' "$1" 2>/dev/null)
	[ -n "$ci" ] && [ -x "$cn" ] && [ -f "$cc" ] && printf '%s' "$ci"
}`;

function markerCheck(context: ReviewRemoteInstallContext, input: { version: string; integrity: string }): string {
	return `v=${shellQuote(reviewRemoteVersionDir(context.home, input.version))}
m="$v/${REVIEW_REMOTE_INSTALL_MARKER}"
${REVIEW_REMOTE_COMPLETE_INTEGRITY}
complete=
[ -f "$m" ] && [ "$(completeIntegrity "$m")" = ${shellQuote(input.integrity)} ] && complete=1`;
}

export function completeScript(context: ReviewRemoteInstallContext, input: { version: string; integrity: string }): string {
	return `${prelude(context)}${markerCheck(context, input)}
[ -n "$complete" ] || exit 0
say COMPLETE
say MARKER "$(cat "$m")"
guard "$v/whiteboard" remote diffr ensure --json </dev/null 2>/dev/null
say DIFFR-DONE
`;
}

export function partScript(context: ReviewRemoteInstallContext, part: { node: string } | { package: string }): string {
	const dir = "node" in part ? nodePart(context, part.node) : versionPart(context, part.package);
	return `${prelude(context)}own
d=${shellQuote(dir)}
rm -rf "$d" && mkdir -p "$d" || fail cannot create "$d"
say READY
`;
}

export const nodeTarball = (context: ReviewRemoteInstallContext, nodeVersion: string) => `${nodePart(context, nodeVersion)}/node.tar.xz`;
export const packageTarball = (context: ReviewRemoteInstallContext, version: string) => `${versionPart(context, version)}/package.tgz`;

export function downloadScript(context: ReviewRemoteInstallContext, input: { url: string; file: string; downloader: "curl" | "wget" }): string {
	const fetch =
		input.downloader === "curl"
			? `guard curl -fsSL --connect-timeout 20 --max-time 900 -o "$f" "$url"`
			: `hsts=
wget --help 2>&1 | grep -q -- --no-hsts && hsts=--no-hsts
guard wget -q $hsts -t 2 -T 30 -O "$f" "$url"`;
	return `${prelude(context)}own
f=${shellQuote(input.file)}
url=${shellQuote(input.url)}
${fetch} || { rm -f "$f"; fail the download of "$url" failed; }
say DOWNLOADED
`;
}

export function nodePlaceScript(context: ReviewRemoteInstallContext, input: { nodeVersion: string; sha256: string }): string {
	if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error("The Node checksum is not a sha256.");
	return `${prelude(context)}own
d=${shellQuote(nodePart(context, input.nodeVersion))}
final=${shellQuote(reviewRemoteNodeDir(context.home, input.nodeVersion))}
f="$d/node.tar.xz"
sum=$(sha256sum "$f" 2>/dev/null) || { rm -rf "$d"; fail cannot read "$f"; }
sum=\${sum%% *}
[ "$sum" = ${input.sha256} ] || { rm -rf "$d"; say MISMATCH "$sum"; exit 3; }
tar -xJf "$f" -C "$d" --strip-components=1 || { rm -rf "$d"; fail cannot unpack Node; }
rm -f "$f"
[ "$("$d/bin/node" --version 2>/dev/null)" = v${input.nodeVersion} ] || { rm -rf "$d"; fail the unpacked Node does not run; }
rm -rf "$final" && mv "$d" "$final" || fail cannot move Node into place
say NODE-OK
`;
}

export function packageInstallScript(
	context: ReviewRemoteInstallContext,
	input: { version: string; sha512: string; node: string; npm: string; registry?: string },
): string {
	if (!/^[0-9a-f]{128}$/.test(input.sha512)) throw new Error("The package checksum is not a sha512.");
	const nodeBin = input.node.slice(0, input.node.lastIndexOf("/"));
	const registry = input.registry ? ` --registry=${shellQuote(input.registry)}` : "";
	return `${prelude(context)}own
p=${shellQuote(versionPart(context, input.version))}
f="$p/package.tgz"
if command -v sha512sum >/dev/null 2>&1; then sum=$(sha512sum "$f" 2>/dev/null)
elif command -v openssl >/dev/null 2>&1; then sum=$(openssl dgst -sha512 -r "$f" 2>/dev/null)
else rm -rf "$p"; fail neither sha512sum nor openssl is installed; fi
sum=\${sum%% *}
[ "$sum" = ${input.sha512} ] || { rm -rf "$p"; say MISMATCH "$sum"; exit 3; }
PATH=${shellQuote(nodeBin)}:$PATH
export PATH
guard ${shellQuote(input.npm)} install --ignore-scripts --no-audit --no-fund --no-update-notifier --loglevel=error --cache "$p/.npm-cache" --prefix "$p"${registry} "$f" > "$p/.npm.log" 2>&1 || {
	tail -n 15 "$p/.npm.log" >&3
	rm -rf "$p"
	fail npm could not install the package
}
rm -rf "$p/.npm-cache" "$p/.npm.log" "$f"
say INSTALLED
`;
}

export function verifyScript(context: ReviewRemoteInstallContext, input: { version: string; node: string }): string {
	return `${prelude(context)}own
p=${shellQuote(versionPart(context, input.version))}
node=${shellQuote(input.node)}
pkg="$p/node_modules/@dev.fast/whiteboard"
bin=$("$node" -p 'require(process.argv[1]).bin.whiteboard' "$pkg/package.json" 2>/dev/null)
case "$bin" in ''|/*|*..*) fail the package names no whiteboard command ;; esac
bin=\${bin#./}
cd "$p" || fail cannot enter "$p"
out=$(DEV_FAST_REVIEW_CLI_NO_DELEGATE=1 DEV_FAST_REVIEW_TELEMETRY_DISABLED=1 "$node" "$pkg/$bin" version --json </dev/null 2>/dev/null | tail -n 1)
say BIN "$bin"
say VERSION "$out"
`;
}

export function finishScript(
	context: ReviewRemoteInstallContext,
	input: { version: string; launcher: string; marker: string; wrapper?: string },
): string {
	const wrapper = input.wrapper
		? `w=${shellQuote(reviewRemoteWrapperPath(context.home))}
if { [ ! -e "$w" ] && [ ! -L "$w" ]; } || { [ -f "$w" ] && [ ! -L "$w" ] && grep -qxF ${shellQuote(REVIEW_REMOTE_WRAPPER_MARK)} "$w"; }; then
	if mkdir -p "\${w%/*}" && printf '%s' ${shellQuote(input.wrapper, true)} > "$w.$token.part" && chmod 755 "$w.$token.part" && mv -f "$w.$token.part" "$w"; then
		say WRAPPER written
	else
		rm -f "$w.$token.part"
		say WRAPPER failed
	fi
else
	say WRAPPER foreign
fi
`
		: "";
	return `${prelude(context)}own
p=${shellQuote(versionPart(context, input.version))}
v=${shellQuote(reviewRemoteVersionDir(context.home, input.version))}
printf '%s' ${shellQuote(input.launcher, true)} > "$p/whiteboard" && chmod 755 "$p/whiteboard" || fail cannot write the launcher
printf '%s\\n' ${shellQuote(input.marker)} > "$p/${REVIEW_REMOTE_INSTALL_MARKER}" || fail cannot write the marker
[ -e "$v" ] && { rm -rf "$p"; fail "$v" appeared during the install; }
mv "$p" "$v" || fail cannot move the version into place
say COMPLETE
${wrapper}rm -rf "$root"/versions/*.part "$root"/node/*.part
say FINISHED
`;
}

export function cleanupScript(context: ReviewRemoteInstallContext, input: { candidates: readonly string[]; room: number }): string {
	const names = input.candidates.map((name) => shellQuote(name)).join(" ");
	return `${prelude(context)}own
# Every command line, read once: a grep below must not find itself. The
# launchers run the CLI by absolute path, so its version's path is there.
if [ -d /proc/self ]; then
	procs=$(for f in /proc/[0-9]*/cmdline; do tr '\\000' ' ' < "$f" 2>/dev/null; echo; done)
else
	procs=$(ps -eo args= 2>/dev/null)
fi
running() { printf '%s\\n' "$procs" | grep -qF -- "$root/versions/$1/"; }
kept=0
for v in ${names}; do running "$v" && kept=$((kept + 1)); done
for v in ${names}; do
	if running "$v"; then say IN-USE "$v"; continue; fi
	if [ "$kept" -lt ${input.room} ]; then kept=$((kept + 1)); continue; fi
	d="$root/versions/$v"
	[ -f "$d/${REVIEW_REMOTE_INSTALL_MARKER}" ] || continue
	rm -f "$d/${REVIEW_REMOTE_INSTALL_MARKER}" && rm -rf "$d" && say REMOVED "$v"
done
say CLEANED
`;
}

export function diffrScript(context: ReviewRemoteInstallContext, input: { launcher: string }): string {
	return `${prelude(context)}own
guard ${shellQuote(input.launcher)} remote diffr ensure --json </dev/null 2>/dev/null
say DIFFR-DONE
`;
}
