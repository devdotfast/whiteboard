# BurntSushi/ripgrep #3496

Production changes inside an iterator plus a new regression test. Paired use groups, an added test-body fold with its attribute/signature retained, and file-level context for both the iterator and the distant test module. One annotation model covers both regions.

[Original PR](https://github.com/BurntSushi/ripgrep/pull/3496) · [Before](before.rs) · [After](after.rs) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**rhs · ordinary diff · {'line': 2436, 'byte_column': 0} → {'line': 2437, 'byte_column': 59}**

```rust
    #[test]
    fn max_depth_does_not_load_unreachable_ignore_files() {
```

**rhs · extra context · {'line': 1260, 'byte_column': 0} → {'line': 1261, 'byte_column': 1}**

```rust
    }
}
```

**rhs · extra context · {'line': 2739, 'byte_column': 0} → {'line': 2739, 'byte_column': 1}**

```rust
}
```

**rhs · ordinary diff · {'line': 1245, 'byte_column': 0} → {'line': 1245, 'byte_column': 41}**

```rust
                    return Some(Ok(ent));
```

**rhs · ordinary diff · {'line': 2455, 'byte_column': 0} → {'line': 2455, 'byte_column': 5}**

```rust
    }
```

**lhs · extra context · {'line': 1253, 'byte_column': 0} → {'line': 1254, 'byte_column': 1}**

```rust
    }
}
```

**lhs · extra context · {'line': 2711, 'byte_column': 0} → {'line': 2711, 'byte_column': 1}**

```rust
}
```

**lhs · ordinary diff · {'line': 1238, 'byte_column': 0} → {'line': 1238, 'byte_column': 41}**

```rust
                    return Some(Ok(ent));
```

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 0, 'byte_column': 0} → {'line': 23, 'byte_column': 2}

```rust
use std::{
    cmp::Ordering,
    ffi::OsStr,
    fs::{self, FileType, Metadata},
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering},
    sync::{Arc, OnceLock},
};

use {
    crossbeam_deque::{Stealer, Worker as Deque},
    same_file::Handle,
    walkdir::WalkDir,
};

use crate::{
    Error, PartialErrorBuilder,
    dir::{Ignore, IgnoreBuilder},
    gitignore::GitignoreBuilder,
    incremental::{IncrementalIgnore, IncrementalIgnoreOptions},
    overrides::Override,
    types::Types,
};
```

### `folds/0/rhs` · {'line': 0, 'byte_column': 0} → {'line': 23, 'byte_column': 2}

```rust
use std::{
    cmp::Ordering,
    ffi::OsStr,
    fs::{self, FileType, Metadata},
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering},
    sync::{Arc, OnceLock},
};

use {
    crossbeam_deque::{Stealer, Worker as Deque},
    same_file::Handle,
    walkdir::WalkDir,
};

use crate::{
    Error, PartialErrorBuilder,
    dir::{Ignore, IgnoreBuilder},
    gitignore::GitignoreBuilder,
    incremental::{IncrementalIgnore, IncrementalIgnoreOptions},
    overrides::Override,
    types::Types,
};
```

Placeholder: Assert that max-depth traversal skips unreachable ignore files.

### `folds/1/rhs` · {'line': 2438, 'byte_column': 0} → {'line': 2454, 'byte_column': 53}

```rust
        let td = tmpdir();
        let leaf = td.path().join("leaf");
        mkdirp(&leaf);
        wfile(leaf.join(".ignore"), "{invalid\n");

        let mut builder = WalkBuilder::new(td.path());
        builder.max_depth(Some(1));
        let entry = builder
            .build()
            .find_map(|result| {
                let entry = result.unwrap();
                (entry.path() == leaf).then_some(entry)
            })
            .unwrap();

        assert!(entry.error().is_none());
        assert_paths(td.path(), &builder, &["leaf"]);
```

### `context/0/lhs` · {'line': 1183, 'byte_column': 0} → {'line': 1183, 'byte_column': 24}

```rust
impl Iterator for Walk {
```

### `context/0/rhs` · {'line': 1185, 'byte_column': 0} → {'line': 1185, 'byte_column': 24}

```rust
impl Iterator for Walk {
```

### `context/1/lhs` · {'line': 1187, 'byte_column': 0} → {'line': 1187, 'byte_column': 59}

```rust
    fn next(&mut self) -> Option<Result<DirEntry, Error>> {
```

### `context/1/rhs` · {'line': 1189, 'byte_column': 0} → {'line': 1189, 'byte_column': 59}

```rust
    fn next(&mut self) -> Option<Result<DirEntry, Error>> {
```

### `context/2/lhs` · {'line': 2186, 'byte_column': 0} → {'line': 2186, 'byte_column': 11}

```rust
mod tests {
```

### `context/2/rhs` · {'line': 2193, 'byte_column': 0} → {'line': 2193, 'byte_column': 11}

```rust
mod tests {
```

### `context/3/lhs` · {'line': 1253, 'byte_column': 0} → {'line': 1254, 'byte_column': 1}

```rust
    }
}
```

### `context/3/rhs` · {'line': 1260, 'byte_column': 0} → {'line': 1261, 'byte_column': 1}

```rust
    }
}
```

### `context/4/lhs` · {'line': 2711, 'byte_column': 0} → {'line': 2711, 'byte_column': 1}

```rust
}
```

### `context/4/rhs` · {'line': 2739, 'byte_column': 0} → {'line': 2739, 'byte_column': 1}

```rust
}
```

## Struct field context

The added `Walk.max_depth` field must also expose `pub struct Walk {` and the
matching closing brace on both sides, including the unchanged base-side struct.
These boundaries are asserted in `case.json` and specified as extra context.
