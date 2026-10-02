#!/usr/bin/env python3
"""Build a sealed signed RPM/DNF, DEB/APT and pacman publication without network writes."""

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def run(*args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, **kwargs).stdout


def digest(file):
    result = hashlib.sha256()
    with open(file, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def sign(file, fingerprint, armor=True):
    # DNF reads armored .asc; pacman reads binary .sig.
    output = file.with_name(file.name + (".asc" if armor else ".sig"))
    args = ["gpg", "--batch", "--yes", "--local-user", fingerprint]
    passphrase = os.environ.get("REVIEW_SIGNING_PASSPHRASE_FILE")
    if passphrase:
        args += ["--pinentry-mode", "loopback", "--passphrase-file", passphrase]
    run(*args, *(["--armor"] if armor else []), "--output", str(output), "--detach-sign", str(file))
    run("gpg", "--batch", "--verify", str(output), str(file))


def sign_rpm(file, fingerprint, public_key):
    # Use GnuPG on both RPM 4 (CI builder) and RPM 6 (Fedora). The key stays in
    # GNUPGHOME; no private credentials enter the native-package build container.
    args = ["rpmsign", "--define", "_openpgp_sign gpg",
            "--define", f"_openpgp_sign_id {fingerprint}",
            "--define", f"_gpg_name {fingerprint}",
            "--define", f"__gpg {shutil.which('gpg')}"]
    passphrase = os.environ.get("REVIEW_SIGNING_PASSPHRASE_FILE")
    if passphrase:
        if any(character in passphrase for character in "\n\r\"%"):
            raise ValueError("Invalid signing passphrase file path")
        args += ["--define", f'_gpg_sign_cmd_extra_args --pinentry-mode loopback --passphrase-file "{passphrase}"']
    run(*args, "--addsign", str(file))
    # Verify with an isolated RPM key database, without changing the host's trust.
    with tempfile.TemporaryDirectory(prefix="review-rpm-keys-") as database:
        run("rpmkeys", "--dbpath", database, "--import", str(public_key))
        checked = run("rpmkeys", "--dbpath", database, "--checksig", str(file), env={**os.environ, "LC_ALL": "C"}).decode()
        if "signatures OK" not in checked:
            raise ValueError("RPM has no valid package signature")


def build_apt(packages, repos, snapshot_root, package_name, version, revision, fingerprint, channel):
    name = f"{package_name}_{version}-{revision}_amd64.deb"
    source = packages / name
    metadata = run("dpkg-deb", "--show", "--showformat=${Package}\\n${Version}\\n${Architecture}\\n", str(source)).decode().splitlines()
    if metadata != [package_name, f"{version}-{revision}", "amd64"]:
        raise ValueError("DEB metadata does not match the release")
    apt = repos / "apt"
    pool = apt / "pool/main"
    pool.mkdir(parents=True)
    shutil.copyfile(source, pool / name)
    suite = f"dists/{channel}"
    snapshot = snapshot_root / "apt" / suite
    index = snapshot / "main/binary-amd64"
    index.mkdir(parents=True)
    (index / "Packages").write_bytes(run("apt-ftparchive", "packages", "pool", cwd=apt))
    (index / "Packages.gz").write_bytes(gzip.compress((index / "Packages").read_bytes(), mtime=0))
    hashes = apt / suite / "main/binary-amd64/by-hash/SHA256"
    hashes.mkdir(parents=True)
    entries = []
    for file in sorted(index.iterdir()):
        sha = digest(file)
        shutil.copyfile(file, hashes / sha)
        entries.append(f" {sha} {file.stat().st_size} main/binary-amd64/{file.name}")
    release = snapshot / "Release"
    date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    release.write_text(f"Origin: dev.fast\nLabel: Whiteboard\nSuite: {channel}\nCodename: {channel}\n"
                       f"Date: {date}\nArchitectures: amd64\nComponents: main\nAcquire-By-Hash: yes\n"
                       + "SHA256:\n" + "\n".join(entries) + "\n")
    args = ["gpg", "--batch", "--yes", "--local-user", fingerprint]
    passphrase = os.environ.get("REVIEW_SIGNING_PASSPHRASE_FILE")
    if passphrase:
        args += ["--pinentry-mode", "loopback", "--passphrase-file", passphrase]
    run(*args, "--digest-algo", "SHA256", "--output", str(snapshot / "InRelease"), "--clearsign", str(release))
    run(*args, "--output", str(snapshot / "Release.gpg"), "--detach-sign", str(release))
    run("gpg", "--batch", "--verify", str(snapshot / "InRelease"))
    run("gpg", "--batch", "--verify", str(snapshot / "Release.gpg"), str(release))


def build_arch(packages, repos, snapshot_root, package_name, version, revision, fingerprint):
    name = f"{package_name}-{version}-{revision}-x86_64.pkg.tar.zst"
    source = packages / name
    info = run("tar", "--zstd", "-xOf", str(source), ".PKGINFO").decode()
    fields = dict(line.split(" = ", 1) for line in info.splitlines() if " = " in line)
    if [fields.get("pkgname"), fields.get("pkgver"), fields.get("arch")] != [package_name, f"{version}-{revision}", "x86_64"]:
        raise ValueError("Arch package metadata does not match the release")
    pool = repos / "arch/x86_64"
    pool.mkdir(parents=True)
    shutil.copyfile(source, pool / name)
    sign(pool / name, fingerprint, armor=False)
    # repo-add ran in the unprivileged build container. The databases name this
    # exact package file, and the Worker redirects to them by generation.
    snapshot = snapshot_root / "arch/x86_64"
    snapshot.mkdir(parents=True)
    for kind in ("db", "files"):
        database = snapshot / f"{package_name}.{kind}"
        shutil.copyfile(packages / f"{package_name}.{kind}.tar.gz", database)
        sign(database, fingerprint, armor=False)


def build_nixos(packages, snapshot_root, package_name, version, revision, commit, fingerprint):
    app_version = version.replace("~preview.", "-preview.")
    name = f"{package_name}-{app_version}-{revision}-x86_64.nix.tar.gz"
    source = packages / name
    with tarfile.open(source, "r:gz") as archive:
        metadata = json.load(archive.extractfile("package/release.json"))
        product = json.load(archive.extractfile(f"package/payload/usr/share/{package_name}/resources/app/product.json"))
        if [metadata.get(key) for key in ("packageName", "version", "revision", "commit")] != [package_name, app_version, revision, commit]:
            raise ValueError("NixOS metadata does not match the release")
        if [product.get(key) for key in ("applicationName", "reviewVersion", "commit")] != [package_name, app_version, commit]:
            raise ValueError("NixOS payload does not match the release")
        for file in ("flake.nix", "flake.lock", "package.nix"):
            if not archive.getmember(f"package/{file}").isfile():
                raise ValueError(f"NixOS package is missing {file}")
    snapshot = snapshot_root / "nixos/x86_64"
    snapshot.mkdir(parents=True)
    package = snapshot / f"{package_name}.nix.tar.gz"
    shutil.copyfile(source, package)
    sign(package, fingerprint)
    shutil.copyfile(package.with_name(package.name + ".asc"), packages / (name + ".asc"))


# Each channel is a separate package in a separate repository. Preview builds
# use RPM's tilde form so they sort below the stable release they precede.
CHANNELS = {
    "stable": ("whiteboard", "repos", r"[0-9]+\.[0-9]+\.[0-9]+"),
    "preview": ("whiteboard-preview", "repos/preview", r"[0-9]+\.[0-9]+\.[0-9]+~preview\.[0-9]{8}\.[0-9]+"),
}


def build(packages, output, version, revision, commit, fingerprint, channel="stable"):
    package_name, prefix, version_pattern = CHANNELS[channel]
    if not re.fullmatch(version_pattern, version):
        raise ValueError(f"Expected a {channel} package version")
    if not re.fullmatch(r"[1-9][0-9]*", revision) or not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Invalid package revision or source commit")
    if not re.fullmatch(r"[A-F0-9]{40}", fingerprint):
        raise ValueError("Expected the full signing key fingerprint")
    if output.exists():
        raise ValueError("Output already exists; use a fresh directory to avoid mixing publications")
    name = f"{package_name}-{version}-{revision}.x86_64.rpm"
    source = packages / name
    metadata = run("rpm", "-qp", "--queryformat", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n", str(source)).decode().splitlines()
    if metadata != [package_name, version, revision, "x86_64"]:
        raise ValueError("RPM metadata does not match the release")
    generation = f"{version}-{revision}-{commit}"
    repos = output / prefix
    snapshot = repos / "snapshots" / generation / "rpm/repodata"
    snapshot.mkdir(parents=True)
    # Both channels trust the same key, served from repos/keys/.
    keys = output / "repos/keys"
    keys.mkdir(parents=True, exist_ok=True)
    public_key = keys / f"{fingerprint}.asc"
    public_key.write_bytes(run("gpg", "--batch", "--armor", "--export", fingerprint))
    if not public_key.stat().st_size:
        raise ValueError("Signing public key was not exported")
    rpm = repos / "rpm/x86_64"
    pool = rpm / "Packages"
    pool.mkdir(parents=True)
    package = pool / name
    shutil.copyfile(source, package)
    sign_rpm(package, fingerprint, public_key)
    # Package signatures change bytes. Generate checksums only after signing.
    run("createrepo_c", "--no-database", "--unique-md-filenames", "--checksum", "sha256",
        "--revision", f"{version}-{revision}", str(rpm))
    for file in (rpm / "repodata").iterdir():
        if file.name == "repomd.xml":
            continue
        match = re.fullmatch(r"([a-f0-9]{64})-(primary|filelists|other)\.xml\.gz", file.name)
        if not match or digest(file) != match.group(1):
            raise ValueError(f"Unexpected or non-content-addressed RPM metadata: {file.name}")
    (rpm / "repodata/repomd.xml").rename(snapshot / "repomd.xml")
    sign(snapshot / "repomd.xml", fingerprint)
    build_apt(packages, repos, repos / "snapshots" / generation, package_name, version, revision, fingerprint, channel)
    build_arch(packages, repos, repos / "snapshots" / generation, package_name, version, revision, fingerprint)
    build_nixos(packages, repos / "snapshots" / generation, package_name, version, revision, commit, fingerprint)
    pointer = {
        "schemaVersion": 1, "format": "rpm", "packageName": package_name, "deb": True, "arch": True, "nixos": True, "generation": generation, "version": version,
        "commit": commit, "keyFingerprint": fingerprint,
    }
    (repos / "current.json").write_text(json.dumps(pointer) + "\n")
    files = {str(file.relative_to(output)): digest(file) for file in sorted((output / "repos").rglob("*")) if file.is_file()}
    (output / "sha256.json").write_text(json.dumps(files, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--revision", default="1")
    parser.add_argument("--commit", required=True)
    parser.add_argument("--fingerprint", required=True)
    parser.add_argument("--channel", choices=sorted(CHANNELS), default="stable")
    args = parser.parse_args()
    build(args.packages.resolve(), args.output.resolve(), args.version, args.revision, args.commit, args.fingerprint, args.channel)
