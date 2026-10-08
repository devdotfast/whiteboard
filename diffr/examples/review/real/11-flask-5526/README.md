# Flask #5526: changed typed function parameter

An existing method gains a typed encoding parameter; its signature grows from one line to three. Pair the docstring and setup as one fold, keeping complete signatures and final return expressions visible. The enclosing class is extra context; signatures and returns are already in the diff.

[Original PR](https://github.com/pallets/flask/pull/5526) · [Before](before.py) · [After](after.py) · [Git patch](change.patch) · [Expected annotations](expected.json) · [Provenance](provenance.json)

Annotations are manually selected targets, not recorded matcher output. Coordinates below are zero-based UTF-8 byte positions with exclusive ends.

## Kept visible

**lhs · ordinary diff · {'line': 103, 'byte_column': 0} → {'line': 103, 'byte_column': 79}**

```python
    def open_resource(self, resource: str, mode: str = "rb") -> t.IO[t.AnyStr]:
```

**lhs · ordinary diff · {'line': 128, 'byte_column': 0} → {'line': 128, 'byte_column': 65}**

```python
        return open(os.path.join(self.root_path, resource), mode)
```

**rhs · ordinary diff · {'line': 103, 'byte_column': 0} → {'line': 105, 'byte_column': 24}**

```python
    def open_resource(
        self, resource: str, mode: str = "rb", encoding: str | None = "utf-8"
    ) -> t.IO[t.AnyStr]:
```

**rhs · ordinary diff · {'line': 127, 'byte_column': 0} → {'line': 127, 'byte_column': 50}**

```python
        return open(path, mode, encoding=encoding)
```

## Fold and context selections

Placeholder: Open a blueprint-relative resource for reading.

### `folds/0/lhs` · {'line': 104, 'byte_column': 0} → {'line': 126, 'byte_column': 73}

```python
        """Open a resource file relative to :attr:`root_path` for
        reading.

        For example, if the file ``schema.sql`` is next to the file
        ``app.py`` where the ``Flask`` app is defined, it can be opened
        with:

        .. code-block:: python

            with app.open_resource("schema.sql") as f:
                conn.executescript(f.read())

        :param resource: Path to the resource relative to
            :attr:`root_path`.
        :param mode: Open the file in this mode. Only reading is
            supported, valid values are "r" (or "rt") and "rb".

        Note this is a duplicate of the same method in the Flask
        class.

        """
        if mode not in {"r", "rt", "rb"}:
            raise ValueError("Resources can only be opened for reading.")
```

### `folds/0/rhs` · {'line': 106, 'byte_column': 0} → {'line': 125, 'byte_column': 35}

```python
        """Open a resource file relative to :attr:`root_path` for reading. The
        blueprint-relative equivalent of the app's :meth:`~.Flask.open_resource`
        method.

        :param resource: Path to the resource relative to :attr:`root_path`.
        :param mode: Open the file in this mode. Only reading is supported,
            valid values are ``"r"`` (or ``"rt"``) and ``"rb"``.
        :param encoding: Open the file with this encoding when opening in text
            mode. This is ignored when opening in binary mode.

        .. versionchanged:: 3.1
            Added the ``encoding`` parameter.
        """
        if mode not in {"r", "rt", "rb"}:
            raise ValueError("Resources can only be opened for reading.")

        path = os.path.join(self.root_path, resource)

        if mode == "rb":
            return open(path, mode)
```

### `context/0/lhs` · {'line': 17, 'byte_column': 0} → {'line': 17, 'byte_column': 33}

```python
class Blueprint(SansioBlueprint):
```

### `context/0/rhs` · {'line': 17, 'byte_column': 0} → {'line': 17, 'byte_column': 33}

```python
class Blueprint(SansioBlueprint):
```
