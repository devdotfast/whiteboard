# pallets/flask #6133

New decorated method: fold its added docstring, preserving the decorator, complete signature and return expression. The enclosing class is paired extra context; added lines are already visible in the diff.

[Original PR](https://github.com/pallets/flask/pull/6133) · [Before](before.py) · [After](after.py) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**rhs · ordinary diff · {'line': 302, 'byte_column': 0} → {'line': 303, 'byte_column': 83}**

```python
    @setupmethod
    def query(self, rule: str, **options: t.Any) -> t.Callable[[T_route], T_route]:
```

**rhs · ordinary diff · {'line': 308, 'byte_column': 0} → {'line': 308, 'byte_column': 57}**

```python
        return self._method_route("QUERY", rule, options)
```

## Fold and context selections

Placeholder: Register a QUERY route.

### `folds/0/rhs` · {'line': 304, 'byte_column': 0} → {'line': 307, 'byte_column': 11}

```python
        """Shortcut for :meth:`route` with ``methods=["QUERY"]``.

        .. versionadded:: 3.2
        """
```

### `context/0/lhs` · {'line': 51, 'byte_column': 0} → {'line': 51, 'byte_column': 15}

```python
class Scaffold:
```

### `context/0/rhs` · {'line': 51, 'byte_column': 0} → {'line': 51, 'byte_column': 15}

```python
class Scaffold:
```
