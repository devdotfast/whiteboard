# BurntSushi/ripgrep #3487

One match arm changes from a single expression to a braced block. Pair those regions despite different syntax shapes; leave adjacent match arms visible. The unchanged run signature is extra context. This pairing is a manual target, not a claim that Difftastic already identifies a match-arm node.

[Original PR](https://github.com/BurntSushi/ripgrep/pull/3487) · [Before](before.rs) · [After](after.rs) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · ordinary diff · {'line': 89, 'byte_column': 0} → {'line': 89, 'byte_column': 60}**

```rust
        Mode::Files if args.threads() == 1 => files(&args)?,
```

**lhs · extra context · {'line': 94, 'byte_column': 0} → {'line': 101, 'byte_column': 1}**

```rust
    Ok(if matched && (args.quiet() || !messages::errored()) {
        ExitCode::from(0)
    } else if messages::errored() {
        ExitCode::from(2)
    } else {
        ExitCode::from(1)
    })
}
```

**rhs · ordinary diff · {'line': 94, 'byte_column': 0} → {'line': 94, 'byte_column': 60}**

```rust
        Mode::Files if args.threads() == 1 => files(&args)?,
```

**rhs · extra context · {'line': 99, 'byte_column': 0} → {'line': 106, 'byte_column': 1}**

```rust
    Ok(if matched && (args.quiet() || !messages::errored()) {
        ExitCode::from(0)
    } else if messages::errored() {
        ExitCode::from(2)
    } else {
        ExitCode::from(1)
    })
}
```

## Fold and context selections

Placeholder: Handle indexing mode.

### `folds/0/lhs` · {'line': 88, 'byte_column': 0} → {'line': 88, 'byte_column': 72}

```rust
        Mode::Index(_) => anyhow::bail!("indexing not yet implemented"),
```

### `folds/0/rhs` · {'line': 90, 'byte_column': 0} → {'line': 93, 'byte_column': 9}

```rust
        Mode::Index(_) => {
            index::write(&args)?;
            return Ok(ExitCode::from(0));
        }
```

### `context/0/lhs` · {'line': 76, 'byte_column': 0} → {'line': 76, 'byte_column': 79}

```rust
fn run(result: crate::flags::ParseResult<HiArgs>) -> anyhow::Result<ExitCode> {
```

### `context/0/rhs` · {'line': 77, 'byte_column': 0} → {'line': 77, 'byte_column': 79}

```rust
fn run(result: crate::flags::ParseResult<HiArgs>) -> anyhow::Result<ExitCode> {
```

### `context/1/lhs` · {'line': 94, 'byte_column': 0} → {'line': 101, 'byte_column': 1}

```rust
    Ok(if matched && (args.quiet() || !messages::errored()) {
        ExitCode::from(0)
    } else if messages::errored() {
        ExitCode::from(2)
    } else {
        ExitCode::from(1)
    })
}
```

### `context/1/rhs` · {'line': 99, 'byte_column': 0} → {'line': 106, 'byte_column': 1}

```rust
    Ok(if matched && (args.quiet() || !messages::errored()) {
        ExitCode::from(0)
    } else if messages::errored() {
        ExitCode::from(2)
    } else {
        ExitCode::from(1)
    })
}
```

Context policy: distant return values are no longer required. Preserve enclosing
signatures and closing delimiters; return boundaries require a change inside the
return expression. The updated case assertions reflect this rule.
