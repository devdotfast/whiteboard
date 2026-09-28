#!/usr/bin/env python3
"""Upload a sealed Linux publication, then atomically promote its R2 pointer."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request


def aws(*args):
    result = subprocess.run(["aws", "s3api", *args], capture_output=True, text=True)
    if result.returncode:
        # AWS's error message contains no request credentials. Do not print env.
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def checksum(file):
    result = hashlib.sha256()
    with open(file, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Review-Linux-Repository-Publisher/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


# Each channel is a separate package in a separate repository prefix. The sealed
# publication identifies its channel by which pointer it carries.
CHANNELS = {"stable": "repos", "preview": "repos/preview"}
GENERATION = re.compile(r"([0-9]+)\.([0-9]+)\.([0-9]+)(?:~preview\.([0-9]{8})\.([0-9]+))?-([1-9][0-9]*)-([a-f0-9]{40})")


def parse_generation(pointer):
    generation = GENERATION.fullmatch(pointer.get("generation", ""))
    if not generation:
        return None, None
    major, minor, patch, date, number, revision, commit = generation.groups()
    version = f"{major}.{minor}.{patch}" + (f"~preview.{date}.{number}" if date else "")
    # Previews order by build date and run; a stable release has no prerelease part.
    order = (int(major), int(minor), int(patch), int(date or 0), int(number or 0), int(revision))
    return (version, commit, date is not None), order


def publication_format(name):
    if "/keys/" in name or "/rpm/" in name:
        return "rpm"
    if "/apt/" in name:
        return "deb"
    if "/arch/" in name:
        return "arch"
    raise ValueError(f"Unknown publication format: {name}")


def publish(directory, bucket, base_url, channel=None, upload_format=None, promote_only=False):
    if upload_format and promote_only:
        raise ValueError("Upload and promotion must be separate operations")
    if upload_format and upload_format not in ("rpm", "deb", "arch"):
        raise ValueError("Unknown upload format")
    if fetch_json(base_url + "/repos/health") != {"schemaVersion": 1, "format": "rpm"}:
        raise RuntimeError("Deploy the Linux repository Worker before publishing")
    files = json.loads((directory / "sha256.json").read_text())
    pointers = [name for name, prefix in CHANNELS.items() if f"{prefix}/current.json" in files]
    if len(pointers) != 1 or (channel and channel != pointers[0]):
        raise ValueError(f"Publication is not a single {channel or 'channel'} pointer")
    channel = pointers[0]
    prefix = CHANNELS[channel]
    pointer_key = f"{prefix}/current.json"
    for name, sha in files.items():
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or not name.startswith("repos/") or not re.fullmatch(r"[a-f0-9]{64}", sha):
            raise ValueError("Invalid publication digest entry")
        if checksum(directory / name) != sha:
            raise ValueError(f"Publication checksum mismatch: {name}")

    pointer = directory / pointer_key
    current = json.loads(pointer.read_text())
    identity, new_version = parse_generation(current)
    if (not identity or identity[2] != (channel == "preview")
            or current.get("schemaVersion") != 1 or current.get("format") != "rpm"
            or current.get("version") != identity[0] or current.get("commit") != identity[1]
            or not re.fullmatch(r"[A-F0-9]{40}", current.get("keyFingerprint", ""))):
        raise ValueError("Invalid repository pointer")
    package_name = current.get("packageName")
    if package_name:
        expected = "whiteboard" + ("-preview" if channel == "preview" else "")
        if package_name != expected:
            raise ValueError("Invalid Linux package name")
        supported = fetch_json(base_url + "/repos/whiteboard/health")
        if package_name not in supported.get("packageNames", []):
            raise RuntimeError("Deploy the Whiteboard repository Worker before publishing")
    if current.get("deb") is True:
        if fetch_json(base_url + "/repos/apt/health") != {"schemaVersion": 1, "format": "deb"}:
            raise RuntimeError("Deploy the Ubuntu repository Worker before publishing")
        required = [
            f"{prefix}/snapshots/{current['generation']}/apt/dists/{channel}/{name}"
            for name in ["InRelease", "Release", "Release.gpg", "main/binary-amd64/Packages", "main/binary-amd64/Packages.gz"]
        ]
        if any(name not in files for name in required):
            raise ValueError("Incomplete APT publication")
    if current.get("arch") is True:
        if fetch_json(base_url + "/repos/arch/health") != {"schemaVersion": 1, "format": "pacman"}:
            raise RuntimeError("Deploy the Arch repository Worker before publishing")
        required = [
            f"{prefix}/snapshots/{current['generation']}/arch/x86_64/{package_name}.{name}"
            for name in ["db", "db.sig", "files", "files.sig"]
        ]
        if not package_name or any(name not in files for name in required):
            raise ValueError("Incomplete Arch publication")
    # Compare-and-swap prevents concurrent or stale workflow reruns from moving
    # the repository backwards after a newer release has already won.
    with tempfile.TemporaryDirectory(prefix="review-current-") as temporary:
        previous_path = Path(temporary) / "current.json"
        try:
            previous_object = aws("get-object", "--bucket", bucket, "--key", pointer_key, str(previous_path))
        except RuntimeError as error:
            if "NoSuchKey" not in str(error) and "(404)" not in str(error):
                raise
            condition = ["--if-none-match", "*"]
        else:
            previous = json.loads(previous_path.read_text())
            _, old_version = parse_generation(previous)
            if not old_version:
                raise ValueError("Existing repository pointer is invalid")
            if new_version < old_version or (new_version == old_version and current != previous):
                raise ValueError("Refusing to replace an equal or newer package release")
            condition = ["--if-match", previous_object["ETag"]]

    # A rerun can resume immutable uploads. Never replace an object with other
    # bytes under a versioned filename; rebuilds must increment package revision.
    for name, sha in files.items():
        if name == pointer_key:
            continue
        if promote_only:
            existing = aws("head-object", "--bucket", bucket, "--key", name)
            if existing.get("Metadata", {}).get("sha256") != sha:
                raise RuntimeError(f"Uploaded object differs: {name}")
            continue
        if upload_format and publication_format(name) != upload_format:
            continue
        try:
            aws("put-object", "--bucket", bucket, "--key", name,
                "--body", str(directory / name), "--if-none-match", "*",
                "--metadata", f"sha256={sha}", "--cache-control", "public, max-age=31536000, immutable")
        except RuntimeError as error:
            if "PreconditionFailed" not in str(error) and "412" not in str(error):
                raise
            existing = aws("head-object", "--bucket", bucket, "--key", name)
            if existing.get("Metadata", {}).get("sha256") != sha:
                raise RuntimeError(f"Immutable object differs: {name}; increment the package revision") from error
    if upload_format:
        return
    aws("put-object", "--bucket", bucket, "--key", pointer_key, "--body", str(pointer),
        "--content-type", "application/json", "--cache-control", "no-store", *condition)
    latest = fetch_json(f"{base_url}/api/update/linux-x64/{channel}/" + "0" * 40)
    if latest.get("version") != current["commit"] or latest.get("productVersion") != current["version"]:
        raise RuntimeError("Published Linux feed does not match the release")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--base-url", default="https://install.dev.fast")
    parser.add_argument("--channel", choices=sorted(CHANNELS), help="Refuse a publication built for another channel")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--upload-format", choices=["rpm", "deb", "arch"], help="Upload this format without promoting the shared pointer")
    mode.add_argument("--promote-only", action="store_true", help="Verify all uploaded objects, then promote the shared pointer")
    args = parser.parse_args()
    publish(args.directory.resolve(), args.bucket, args.base_url.rstrip("/"), args.channel, args.upload_format, args.promote_only)
