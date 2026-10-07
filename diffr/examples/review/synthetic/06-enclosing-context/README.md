# 06-enclosing-context

Compact analogue of the screenshot. With three ordinary context lines around the insertion, add the enclosing function signature, return opener, and closing brace. Gaps remain expandable. These extra ranges are file-level and paired; unchanged does not mean same line number. The empty folds list is intentional: omitted diff context is distinct from explicit syntax/replacement folds.

```diff
diff --git a/before.py b/after.py
index e4498480..12e0747e 100644
--- a/before.py
+++ b/after.py
@@ -12,6 +12,7 @@ def permission_map():
         # Review endpoints
         "GET /reviews": "reviewer",
         "POST /reviews": "reviewer",
+        "GET /reviews/findings": "reviewer",
         "GET /settings": "admin",
         "POST /settings": "admin",
         "GET /audit": "admin",
```

Intended visible head-side excerpt (schematic, not renderer output):

```python
def permission_map():
    # … expand hidden context …
    return {
        # … expand hidden context …
        # Review endpoints
        "GET /reviews": "reviewer",
        "POST /reviews": "reviewer",
        "GET /reviews/findings": "reviewer",  # ADDED
        "GET /settings": "admin",
        "POST /settings": "admin",
        "GET /audit": "admin",
        # … expand hidden context …
    }
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [

  ],
  "context": [
    {"Paired": {"lhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 0, "byte_column": 21}}, "rhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 0, "byte_column": 21}}}},
    {"Paired": {"lhs": {"start": {"line": 6, "byte_column": 0}, "end": {"line": 6, "byte_column": 12}}, "rhs": {"start": {"line": 6, "byte_column": 0}, "end": {"line": 6, "byte_column": 12}}}},
    {"Paired": {"lhs": {"start": {"line": 18, "byte_column": 0}, "end": {"line": 18, "byte_column": 5}}, "rhs": {"start": {"line": 19, "byte_column": 0}, "end": {"line": 19, "byte_column": 5}}}}
  ]
}
```
