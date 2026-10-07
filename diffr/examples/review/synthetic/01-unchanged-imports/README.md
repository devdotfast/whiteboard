# 01-unchanged-imports

One paired fold over two unchanged import statements. The changed function remains visible. Its signature is already within ordinary context; no extra context is requested.

```diff
diff --git a/before.py b/after.py
index f0f3a4bb..ab8a444e 100644
--- a/before.py
+++ b/after.py
@@ -2,4 +2,4 @@ import os
 import sys
 
 def main():
-    return 1
+    return 2
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [
    {"regions": {"Paired": {"lhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 1, "byte_column": 10}}, "rhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 1, "byte_column": 10}}}}, "placeholder": "Imports"}
  ],
  "context": [

  ]
}
```
