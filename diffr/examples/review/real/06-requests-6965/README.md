# psf/requests #6965

A deleted legacy compatibility block becomes a base-only fold. The replacement hostname expression stays visible on head. Show the enclosing function and outer try/import context, without inventing an opposite range for the deleted block.

[Original PR](https://github.com/psf/requests/pull/6965) · [Before](before.py) · [After](after.py) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**rhs · ordinary diff · {'line': 238, 'byte_column': 0} → {'line': 238, 'byte_column': 26}**

```python
        host = ri.hostname
```

**rhs · extra context · {'line': 242, 'byte_column': 0} → {'line': 245, 'byte_column': 51}**

```python
            if _netrc:
                # Return with login / password
                login_i = 0 if _netrc[0] else 1
                return (_netrc[login_i], _netrc[2])
```

**lhs · extra context · {'line': 248, 'byte_column': 0} → {'line': 251, 'byte_column': 51}**

```python
            if _netrc:
                # Return with login / password
                login_i = 0 if _netrc[0] else 1
                return (_netrc[login_i], _netrc[2])
```

## Fold and context selections

Placeholder: Legacy netloc and port parsing.

### `folds/0/lhs` · {'line': 239, 'byte_column': 0} → {'line': 244, 'byte_column': 43}

```python
        # Strip port numbers from netloc. This weird `if...encode`` dance is
        # used for Python 3.2, which doesn't support unicode literals.
        splitstr = b":"
        if isinstance(url, str):
            splitstr = splitstr.decode("ascii")
        host = ri.netloc.split(splitstr)[0]
```

### `context/0/lhs` · {'line': 206, 'byte_column': 0} → {'line': 206, 'byte_column': 44}

```python
def get_netrc_auth(url, raise_errors=False):
```

### `context/0/rhs` · {'line': 206, 'byte_column': 0} → {'line': 206, 'byte_column': 44}

```python
def get_netrc_auth(url, raise_errors=False):
```

### `context/1/lhs` · {'line': 215, 'byte_column': 0} → {'line': 216, 'byte_column': 48}

```python
    try:
        from netrc import NetrcParseError, netrc
```

### `context/1/rhs` · {'line': 215, 'byte_column': 0} → {'line': 216, 'byte_column': 48}

```python
    try:
        from netrc import NetrcParseError, netrc
```

### `context/2/lhs` · {'line': 248, 'byte_column': 0} → {'line': 251, 'byte_column': 51}

```python
            if _netrc:
                # Return with login / password
                login_i = 0 if _netrc[0] else 1
                return (_netrc[login_i], _netrc[2])
```

### `context/2/rhs` · {'line': 242, 'byte_column': 0} → {'line': 245, 'byte_column': 51}

```python
            if _netrc:
                # Return with login / password
                login_i = 0 if _netrc[0] else 1
                return (_netrc[login_i], _netrc[2])
```

Context policy: distant return values are no longer required. Preserve enclosing
signatures and closing delimiters; return boundaries require a change inside the
return expression. The updated case assertions reflect this rule.
