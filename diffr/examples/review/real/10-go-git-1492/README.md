# go-git/go-git #1492

The both-have-nodes branch changes from sequential guards to a nested switch. Pair several statements while retaining other outer cases. Extra context shows the complete function signature, enclosing loop/switch openers and closing braces. The success return is already in the diff.

[Original PR](https://github.com/go-git/go-git/pull/1492) · [Before](before.go) · [After](after.go) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · ordinary diff · {'line': 298, 'byte_column': 0} → {'line': 298, 'byte_column': 23}**

```go
		case onlyFromRemains:
```

**lhs · extra context · {'line': 343, 'byte_column': 0} → {'line': 345, 'byte_column': 1}**

```go
		}
	}
}
```

**lhs · extra context · {'line': 295, 'byte_column': 0} → {'line': 295, 'byte_column': 33}**

```go
		switch r := ii.remaining(); r {
```

**lhs · ordinary diff · {'line': 297, 'byte_column': 0} → {'line': 297, 'byte_column': 18}**

```go
			return ret, nil
```

**lhs · extra context · {'line': 285, 'byte_column': 0} → {'line': 285, 'byte_column': 6}**

```go
	for {
```

**rhs · ordinary diff · {'line': 298, 'byte_column': 0} → {'line': 298, 'byte_column': 23}**

```go
		case onlyFromRemains:
```

**rhs · extra context · {'line': 340, 'byte_column': 0} → {'line': 342, 'byte_column': 1}**

```go
		}
	}
}
```

**rhs · extra context · {'line': 295, 'byte_column': 0} → {'line': 295, 'byte_column': 33}**

```go
		switch r := ii.remaining(); r {
```

**rhs · extra context · {'line': 285, 'byte_column': 0} → {'line': 285, 'byte_column': 6}**

```go
	for {
```

**rhs · ordinary diff · {'line': 297, 'byte_column': 0} → {'line': 297, 'byte_column': 18}**

```go
			return ret, nil
```

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 249, 'byte_column': 0} → {'line': 255, 'byte_column': 1}

```go
import (
	"context"
	"errors"
	"fmt"

	"github.com/go-git/go-git/v5/utils/merkletrie/noder"
)
```

### `folds/0/rhs` · {'line': 249, 'byte_column': 0} → {'line': 255, 'byte_column': 1}

```go
import (
	"context"
	"errors"
	"fmt"

	"github.com/go-git/go-git/v5/utils/merkletrie/noder"
)
```

Placeholder: Advance the iterators or compare the current nodes.

### `folds/1/lhs` · {'line': 318, 'byte_column': 0} → {'line': 340, 'byte_column': 4}

```go
		case bothHaveNodes:
			if from.Skip() {
				if err = ret.AddRecursiveDelete(from); err != nil {
					return nil, err
				}
				if err := ii.nextBoth(); err != nil {
					return nil, err
				}
				break
			}
			if to.Skip() {
				if err = ret.AddRecursiveDelete(to); err != nil {
					return nil, err
				}
				if err := ii.nextBoth(); err != nil {
					return nil, err
				}
				break
			}

			if err = diffNodes(&ret, ii); err != nil {
				return nil, err
			}
```

### `folds/1/rhs` · {'line': 316, 'byte_column': 0} → {'line': 337, 'byte_column': 4}

```go
		case bothHaveNodes:
			var err error
			switch {
			case from.Skip():
				if from.Name() == to.Name() {
					err = ii.nextBoth()
				} else {
					err = ii.nextFrom()
				}
			case to.Skip():
				if from.Name() == to.Name() {
					err = ii.nextBoth()
				} else {
					err = ii.nextTo()
				}
			default:
				err = diffNodes(&ret, ii)
			}

			if err != nil {
				return nil, err
			}
```

### `context/0/lhs` · {'line': 276, 'byte_column': 0} → {'line': 277, 'byte_column': 42}

```go
func DiffTreeContext(ctx context.Context, fromTree, toTree noder.Noder,
	hashEqual noder.Equal) (Changes, error) {
```

### `context/0/rhs` · {'line': 276, 'byte_column': 0} → {'line': 277, 'byte_column': 42}

```go
func DiffTreeContext(ctx context.Context, fromTree, toTree noder.Noder,
	hashEqual noder.Equal) (Changes, error) {
```

### `context/1/lhs` · {'line': 343, 'byte_column': 0} → {'line': 345, 'byte_column': 1}

```go
		}
	}
}
```

### `context/1/rhs` · {'line': 340, 'byte_column': 0} → {'line': 342, 'byte_column': 1}

```go
		}
	}
}
```

### `context/2/lhs` · {'line': 295, 'byte_column': 0} → {'line': 295, 'byte_column': 33}

```go
		switch r := ii.remaining(); r {
```

### `context/2/rhs` · {'line': 295, 'byte_column': 0} → {'line': 295, 'byte_column': 33}

```go
		switch r := ii.remaining(); r {
```

### `context/3/lhs` · {'line': 285, 'byte_column': 0} → {'line': 285, 'byte_column': 6}

```go
	for {
```

### `context/3/rhs` · {'line': 285, 'byte_column': 0} → {'line': 285, 'byte_column': 6}

```go
	for {
```
