"""Build release archives and a Homebrew formula from their exact bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

TARGETS = (
    "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
)
ROOT = Path(__file__).resolve().parent.parent
NPM_PLATFORMS = {
    "aarch64-apple-darwin": ("darwin", "arm64"),
    "x86_64-apple-darwin": ("darwin", "x64"),
    "x86_64-unknown-linux-gnu": ("linux", "x64"),
    "aarch64-unknown-linux-gnu": ("linux", "arm64"),
    "x86_64-pc-windows-msvc": ("win32", "x64"),
}


def archive_name(version, target, artifact="diffr"):
    return f"{artifact}-{version}-{target}.tar.gz"


def pack(version, target, install, output):
    exe = ".exe" if "windows" in target else ""
    actual = subprocess.check_output([install / "bin" / f"diffr{exe}", "--version"], text=True).strip()
    if actual != f"diffr {version}":
        raise ValueError(f"Release version mismatch: {actual}")
    for artifact in ("diffr", "diffr-cli"):
        with tarfile.open(output / archive_name(version, target, artifact), "w:gz") as archive:
            binaries = ("diffr", "diffr-tui") if artifact == "diffr" else ("diffr",)
            for name in binaries:
                archive.add(install / "bin" / f"{name}{exe}", arcname=f"{name}{exe}")
            for name in ("LICENSE", "NOTICE", "tui/LICENSE", "tui/themes/LICENSE"):
                archive.add(ROOT / name, arcname=name)


def npm(version, dist, output):
    """Stage one npm package per platform and point @dev.fast/diffr at them."""
    manifest_path = ROOT / "diffr-ts" / "package.json"
    main = json.loads(manifest_path.read_text())
    if main["version"] != version:
        raise ValueError(f"diffr-ts/package.json is {main['version']}, release is {version}")
    main["optionalDependencies"] = {}
    for target, (os, cpu) in NPM_PLATFORMS.items():
        name = f"@dev.fast/diffr-{os}-{cpu}"
        exe = "diffr.exe" if os == "win32" else "diffr"
        directory = output / f"diffr-{os}-{cpu}"
        directory.mkdir(parents=True)
        with tarfile.open(dist / archive_name(version, target, "diffr-cli")) as archive:
            for member in (exe, "LICENSE", "NOTICE"):
                archive.extract(member, directory, filter="data")
        (directory / "package.json").write_text(json.dumps({
            "name": name,
            "version": version,
            "description": f"The diffr {version} executable for {os}-{cpu}",
            "repository": main["repository"],
            "license": main["license"],
            "os": [os],
            "cpu": [cpu],
            **({"libc": ["glibc"]} if os == "linux" else {}),
            "files": [exe, "NOTICE"],
        }, indent=2) + "\n")
        main["optionalDependencies"][name] = version
    manifest_path.write_text(json.dumps(main, indent=2) + "\n")


def formula(version, output):
    checksums = {}
    for target in TARGETS:
        for artifact in ("diffr", "diffr-cli"):
            name = archive_name(version, target, artifact)
            checksums[name] = hashlib.sha256((output / name).read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text("".join(
        f"{checksum}  {name}\n" for name, checksum in checksums.items()
    ))
    url = f"https://github.com/devdotfast/whiteboard/releases/download/diffr-{version}/diffr-{version}"
    (output / "diffr.rb").write_text(f'''class Diffr < Formula
  desc "Structural diffs with an interactive terminal frontend"
  homepage "https://github.com/devdotfast/whiteboard/tree/main/diffr"
  version "{version}"
  license all_of: ["MIT", "MPL-2.0"]

  on_macos do
    on_arm do
      url "{url}-aarch64-apple-darwin.tar.gz"
      sha256 "{checksums[archive_name(version, 'aarch64-apple-darwin')]}"
    end
    on_intel do
      url "{url}-x86_64-apple-darwin.tar.gz"
      sha256 "{checksums[archive_name(version, 'x86_64-apple-darwin')]}"
    end
  end

  on_linux do
    on_arm do
      url "{url}-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "{checksums[archive_name(version, 'aarch64-unknown-linux-gnu')]}"
    end
    on_intel do
      url "{url}-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "{checksums[archive_name(version, 'x86_64-unknown-linux-gnu')]}"
    end
  end

  def install
    bin.install "diffr", "diffr-tui"
    doc.install "NOTICE"
    (pkgshare/"licenses").install "LICENSE"
    (pkgshare/"licenses/tui").install "tui/LICENSE"
    (pkgshare/"licenses/themes").install "tui/themes/LICENSE"
  end

  test do
    assert_match version.to_s, shell_output("#{{bin}}/diffr --version")
    assert_match "theme", shell_output("#{{bin}}/diffr config schema")
    assert_predicate bin/"diffr-tui", :executable?
  end
end
''')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("pack", "formula", "npm"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", choices=TARGETS)
    parser.add_argument("--install", type=Path)
    parser.add_argument("--dist", type=Path, help="release archives, for npm")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("version must be a stable X.Y.Z release")
    args.output.mkdir(parents=True, exist_ok=True)
    if args.command == "pack":
        if not args.target or not args.install:
            parser.error("pack requires --target and --install")
        pack(args.version, args.target, args.install.resolve(), args.output)
    elif args.command == "npm":
        if not args.dist:
            parser.error("npm requires --dist")
        npm(args.version, args.dist, args.output)
    else:
        formula(args.version, args.output)
