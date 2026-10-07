# cli/cli #11038

A paired fallback block grows nested branches and explanatory comments. Tabs count as one byte, not display-width columns. Preserve the receiver-method signature as extra context and the existing return statement outside the fold.

[Original PR](https://github.com/cli/cli/pull/11038) · [Before](before.go) · [After](after.go) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · extra context · {'line': 242, 'byte_column': 0} → {'line': 243, 'byte_column': 1}**

```go
	return token, source
}
```

**rhs · extra context · {'line': 252, 'byte_column': 0} → {'line': 253, 'byte_column': 1}**

```go
	return token, source
}
```

## Fold and context selections

Placeholder: Imports

### `folds/0/lhs` · {'line': 2, 'byte_column': 0} → {'line': 14, 'byte_column': 1}

```go
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/cli/cli/v2/internal/gh"
	"github.com/cli/cli/v2/internal/keyring"
	o "github.com/cli/cli/v2/pkg/option"
	ghauth "github.com/cli/go-gh/v2/pkg/auth"
	ghConfig "github.com/cli/go-gh/v2/pkg/config"
)
```

### `folds/0/rhs` · {'line': 2, 'byte_column': 0} → {'line': 14, 'byte_column': 1}

```go
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/cli/cli/v2/internal/gh"
	"github.com/cli/cli/v2/internal/keyring"
	o "github.com/cli/cli/v2/pkg/option"
	ghauth "github.com/cli/go-gh/v2/pkg/auth"
	ghConfig "github.com/cli/go-gh/v2/pkg/config"
)
```

Placeholder: Resolve a missing token from the keyring.

### `folds/1/lhs` · {'line': 235, 'byte_column': 0} → {'line': 241, 'byte_column': 2}

```go
	if token == "" {
		var err error
		token, err = c.TokenFromKeyring(hostname)
		if err == nil {
			source = "keyring"
		}
	}
```

### `folds/1/rhs` · {'line': 235, 'byte_column': 0} → {'line': 251, 'byte_column': 2}

```go
	if token == "" {
		var user string
		var err error
		if user, err = c.ActiveUser(hostname); err == nil {
			token, err = c.TokenFromKeyringForUser(hostname, user)
		}
		if err != nil {
			// We should generally be able to find a token for the active user,
			// but in some cases such as if the keyring was set up in a very old
			// version of the CLI, it may only have a unkeyed token, so fallback
			// to it.
			token, err = c.TokenFromKeyring(hostname)
		}
		if err == nil {
			source = "keyring"
		}
	}
```

### `context/0/lhs` · {'line': 230, 'byte_column': 0} → {'line': 230, 'byte_column': 68}

```go
func (c *AuthConfig) ActiveToken(hostname string) (string, string) {
```

### `context/0/rhs` · {'line': 230, 'byte_column': 0} → {'line': 230, 'byte_column': 68}

```go
func (c *AuthConfig) ActiveToken(hostname string) (string, string) {
```

### `context/1/lhs` · {'line': 242, 'byte_column': 0} → {'line': 243, 'byte_column': 1}

```go
	return token, source
}
```

### `context/1/rhs` · {'line': 252, 'byte_column': 0} → {'line': 253, 'byte_column': 1}

```go
	return token, source
}
```

Context policy: distant return values are no longer required. Preserve enclosing
signatures and closing delimiters; return boundaries require a change inside the
return expression. The updated case assertions reflect this rule.
