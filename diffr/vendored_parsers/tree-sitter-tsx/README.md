# Patched TSX grammar

Source: tree-sitter/tree-sitter-typescript v0.23.2, commit `f975a621f4e7f532fe322e13c4f79495e0a7b2e7` (MIT).
Patch: [import-type-arrays.patch](import-type-arrays.patch).
Generated parser and license: `../tree-sitter-tsx-src`.

Regenerate from this directory:

```sh
python3 regenerate.py
```

Normal builds use the generated C files. The parser symbol has a `tree_sitter_tsx_diffr` prefix to avoid conflicts with the upstream parser.
