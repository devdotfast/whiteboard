"""Verify a CLI-only release archive without Bun, Git, or user configuration."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile


def check(archive_path, version):
    exe = ".exe" if os.name == "nt" else ""
    with tempfile.TemporaryDirectory(prefix="diffr-cli-smoke-") as directory:
        root = Path(directory)
        with tarfile.open(archive_path) as archive:
            assert set(archive.getnames()) == {
                f"diffr{exe}", "LICENSE", "NOTICE", "packages/tui/LICENSE", "packages/tui/themes/LICENSE",
            }
            archive.extractall(root, filter="data")
        env = {"PATH": "", "HOME": str(root), "XDG_CONFIG_HOME": str(root / "config")}
        if os.name == "nt":
            env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]

        def run(*args):
            return subprocess.check_output(
                [root / f"diffr{exe}", *args], cwd=root, env=env, text=True, timeout=30,
            )

        assert run("--version").strip() == f"diffr {version}"
        (root / "before.rs").write_text("fn main() { let x = 1; }\n")
        (root / "after.rs").write_text("fn main() { let x = 2; }\n")
        records = [json.loads(line) for line in run(
            "--no-index", "--format", "ndjson", "--syntax", "--", "before.rs", "after.rs",
        ).splitlines()]
        assert records[-1]["type"] == "complete", records
        assert records[-1]["succeeded"] == 1 and records[-1]["failed"] == 0, records
        assert any(record["type"] == "file" and "diff" in record for record in records), records
        print(f"PASS CLI-only archive: {archive_path}")


if __name__ == "__main__":
    check(Path(sys.argv[1]).resolve(), sys.argv[2])
