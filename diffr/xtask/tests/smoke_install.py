"""Unix packaging smoke test: python3 xtask/tests/smoke_install.py <install-root>.

Runs copied executables in a fresh directory with empty PATH and isolated config.
Requires an already completed `cargo xtask install --root <install-root>`.
"""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time


def check(root, args, expected):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root)
        env = {
            "PATH": "",
            "HOME": str(root),
            "XDG_CONFIG_HOME": str(root / "config"),
            "TERM": "xterm-256color",
            "LANG": "en_US.UTF-8",
        }
        os.execve(root / "diffr", [str(root / "diffr"), *args], env)
    output = bytearray()
    done = False
    sent_quit = False
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                output.extend(chunk)
                if b"\x1b[6n" in chunk:
                    os.write(fd, b"\x1b[1;1R")
            if expected in output and not sent_quit:
                os.write(fd, b"\x1b" if args == ["config"] else b"q")
                sent_quit = True
            result, status = os.waitpid(pid, os.WNOHANG)
            if result:
                done = True
                assert expected in output, repr(bytes(output))
                assert os.waitstatus_to_exitcode(status) == 0, repr(bytes(output))
                print(f"PASS without Bun or checkout assets: {args}")
                return
        raise AssertionError(f"Timed out: {args}\n{bytes(output)!r}")
    finally:
        if not done:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        os.close(fd)


if __name__ == "__main__":
    install = Path(sys.argv[1]).resolve() / "bin"
    with tempfile.TemporaryDirectory(prefix="diffr-smoke-") as directory:
        root = Path(directory)
        for name in ["diffr", "diffr-tui"]:
            shutil.copy2(install / name, root / name)
        (root / "before.txt").write_text("old packaging\n")
        (root / "after.txt").write_text("standalone packaging\n")
        check(root, ["config"], b"Collapse unchanged lines")
        for theme in ("default-dark", "default-light", "gruvbox", "solarized_light"):
            subprocess.run(
                [root / "diffr", "config", "set", "theme.name", theme],
                env={"PATH": "", "HOME": str(root), "XDG_CONFIG_HOME": str(root / "config")},
                check=True,
                capture_output=True,
            )
            check(root, ["--no-index", "--", "before.txt", "after.txt"], b"standalone")
            print(f"PASS bundled theme: {theme}")
