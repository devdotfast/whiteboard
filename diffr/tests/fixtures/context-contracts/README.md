# Context contracts

Each language's Rust test file contains source pairs, diff actions, expected
visible rows, and comments naming the reviewed contracts. Larger source pairs
and their expected output live alongside the test file.

```sh
cargo test --test context_contracts
```

Assertions use `diffr pprint` with stable relative file paths.
Expected output includes file headers, base/head line numbers, fold IDs and the footer.

`RunStartingAt` and `BodyOf` use one-based lines in the after source.
Each action opens only the selected fold; nested folds keep their own state.
The JSX and TSX cases show a collapsed sibling run, its opened component
outlines, and an opened component body.
