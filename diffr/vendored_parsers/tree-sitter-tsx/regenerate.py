"""Regenerate the patched TSX C parser with the pinned npm toolchain."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT.with_name("tree-sitter-tsx-src")
subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=ROOT, check=True)
subprocess.run(["npm", "rebuild", "tree-sitter-cli"], cwd=ROOT, check=True)
subprocess.run([str(ROOT / "node_modules/.bin/tree-sitter"), "generate"], cwd=ROOT, check=True)
for name in ["parser.c", "grammar.json", "node-types.json"]:
    source = (ROOT / "src" / name).read_text().replace("tree_sitter_tsx", "tree_sitter_tsx_diffr")
    (OUTPUT / name).write_text(source)
shutil.copytree(ROOT / "src/tree_sitter", OUTPUT / "tree_sitter", dirs_exist_ok=True)
