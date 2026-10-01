/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The installer's steps on the remote: short POSIX sh scripts sent to `sh -s`,
 * each run while the laptop holds the install lock. Every script first checks
 * the lock is still this install's (`own`), which also refreshes its age.
 * Answers are `WHITEBOARD-INSTALL <WORD> [value]` lines; everything else on
 * stdout is login noise or a heartbeat.
 *
 * Every path and value from outside is single-quoted by `shellQuote`, which
 * refuses control characters. Work happens in `<name>.<token>.part`
 * directories, which a later install removes; a version appears only by the
 * rename that ends `finishScript`.
 */

export const REVIEW_REMOTE_INSTALL_SAY = "WHITEBOARD-INSTALL";
export const REVIEW_REMOTE_INSTALL_MARKER = ".whiteboard-install.json";
/** The line that marks `~/.local/bin/whiteboard` as Desktop's to replace. */
export const REVIEW_REMOTE_WRAPPER_MARK = "# Written by Whiteboard Desktop, which replaces it with each install.";
/** A lock not refreshed for this long is taken over; every step refreshes it. */
export const REVIEW_REMOTE_LOCK_STALE_SECONDS = 15 * 60;

/** One sh word. Throws on control characters, which no path of ours may hold; `lines` lets a file's newlines through. */
export function shellQuote(value: string, lines = false): string {
	if ((lines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/).test(value)) {
		throw new Error(`${JSON.stringify(value)} holds a control character.`);
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ReviewRemoteInstallContext {
	/** The remote's home, from the probe. */
	readonly home: string;
	/** This install's lock token: hex. */
	readonly token: string;
}

export const reviewRemoteRoot = (home: string) => `${home}/.dev/whiteboard-remote`;
export const reviewRemoteVersionDir = (home: string, version: string) => `${reviewRemoteRoot(home)}/versions/${version}`;
export const reviewRemoteNodeDir = (home: string, nodeVersion: string) => `${reviewRemoteRoot(home)}/node/v${nodeVersion}`;
export const reviewRemoteWrapperPath = (home: string) => `${home}/.local/bin/whiteboard`;

const versionPart = (context: ReviewRemoteInstallContext, version: string) => `${reviewRemoteVersionDir(context.home, version)}.${context.token}.part`;
const nodePart = (context: ReviewRemoteInstallContext, nodeVersion: string) => `${reviewRemoteNodeDir(context.home, nodeVersion)}.${context.token}.part`;

/**
 * `guard` runs a long command in the background and prints a heartbeat each
 * second; once ssh is gone the heartbeat cannot be written, and the command
 * is ended rather than left writing into a `.part` directory.
 */
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

/** Takes the lock (`LOCKED`), or says who holds it (`BUSY`). A stale lock is taken over. */
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

/** Keeps the lock fresh while the laptop uploads; `guard` does the same for commands on the remote. */
export function refreshScript(context: ReviewRemoteInstallContext): string {
	return `${prelude(context)}own
say REFRESHED
`;
}

/** Releases the lock if it is still this install's. */
export function releaseScript(context: ReviewRemoteInstallContext): string {
	return `${prelude(context)}if [ "$(cat "$lock/token" 2>/dev/null)" = "$token" ] && mv "$lock" "$root/install.lock.$token.done" 2>/dev/null; then
	rm -rf "$root/install.lock.$token.done"
fi
say RELEASED
`;
}

/**
 * Removes what earlier installs left, and says what is here: `COMPLETE` and
 * `MARKER <json>` when the version is installed with this integrity and its
 * Node still runs, `HAVE <name>` for every complete version, and
 * `MANAGED-NODE` when the pinned Node is already under `node/`. A version
 * directory with another integrity (a development pack under the same
 * version) is removed.
 */
export function prepareScript(context: ReviewRemoteInstallContext, input: { version: string; integrity: string; nodeVersion: string }): string {
	const nodeDir = reviewRemoteNodeDir(context.home, input.nodeVersion);
	return `${prelude(context)}own
rm -rf "$root"/versions/*.part "$root"/node/*.part "$root"/install.lock.*.stale "$root"/install.lock.*.done
mkdir -p "$root/versions" "$root/node" || fail cannot create "$root/versions"
v=${shellQuote(reviewRemoteVersionDir(context.home, input.version))}
m="$v/${REVIEW_REMOTE_INSTALL_MARKER}"
complete=
if [ -f "$m" ] && [ "$(sed -n 's/.*"integrity":"\\([^"]*\\)".*/\\1/p' "$m")" = ${shellQuote(input.integrity)} ]; then
	node=$(sed -n 's/.*"node":"\\([^"]*\\)".*/\\1/p' "$m")
	cli=$(sed -n 's/.*"cli":"\\([^"]*\\)".*/\\1/p' "$m")
	[ -x "$node" ] && [ -f "$cli" ] && complete=1
fi
if [ -n "$complete" ]; then
	say COMPLETE
	say MARKER "$(cat "$m")"
elif [ -e "$v" ]; then
	mv "$v" ${shellQuote(versionPart(context, input.version))} && rm -rf ${shellQuote(versionPart(context, input.version))} || fail cannot remove "$v"
fi
for dir in "$root"/versions/*; do
	[ -f "$dir/${REVIEW_REMOTE_INSTALL_MARKER}" ] && say HAVE "\${dir##*/}"
done
n=${shellQuote(`${nodeDir}/bin/node`)}
[ -x "$n" ] && [ "$("$n" --version 2>/dev/null)" = v${input.nodeVersion} ] && say MANAGED-NODE
say PREPARED
`;
}

/** An empty work directory for the pinned Node (`node`) or the version (`package`). */
export function partScript(context: ReviewRemoteInstallContext, part: { node: string } | { package: string }): string {
	const dir = "node" in part ? nodePart(context, part.node) : versionPart(context, part.package);
	return `${prelude(context)}own
d=${shellQuote(dir)}
rm -rf "$d" && mkdir -p "$d" || fail cannot create "$d"
say READY
`;
}

/** Where the Node tarball and the package tarball go inside their work directories. */
export const nodeTarball = (context: ReviewRemoteInstallContext, nodeVersion: string) => `${nodePart(context, nodeVersion)}/node.tar.xz`;
export const packageTarball = (context: ReviewRemoteInstallContext, version: string) => `${versionPart(context, version)}/package.tgz`;

/** Downloads `url` to `file` on the remote; a failure removes the file. */
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

/** Checks the uploaded or downloaded Node, unpacks it and moves it into place (`NODE-OK`), or removes it (`MISMATCH`). */
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

/**
 * Checks the package tarball's sha512 (`MISMATCH` removes the work
 * directory), then installs it and its dependencies with npm, scripts off.
 * `registry` is the relay's address on the remote, when there is one.
 */
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

/** Runs the installed CLI's `version --json` from the work directory: `BIN <path>` and `VERSION <json>`. */
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

/**
 * Writes the version's launcher and marker, renames the work directory into
 * place (`COMPLETE`), writes `~/.local/bin/whiteboard` when asked and the
 * path is free or Desktop's (`WRAPPER written|foreign|failed`), and removes
 * every `.part` left behind.
 */
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

/** Runs the version's own `remote diffr ensure`; its JSON line is on stdout. */
export function diffrScript(context: ReviewRemoteInstallContext, input: { launcher: string }): string {
	return `${prelude(context)}own
guard ${shellQuote(input.launcher)} remote diffr ensure --json </dev/null 2>/dev/null
say DIFFR-DONE
`;
}
