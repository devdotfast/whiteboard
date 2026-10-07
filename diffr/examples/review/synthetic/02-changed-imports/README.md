# 02-changed-imports

One paired fold despite an added import. The fold includes the intervening comment, covers multiple statements, and has different lengths on the two sides. Pairing the import group is a proposed rule, not guaranteed upstream matcher output.

```diff
diff --git a/before.py b/after.py
index b1ec4c3e..58559b99 100644
--- a/before.py
+++ b/after.py
@@ -1,6 +1,7 @@
 import os
 # Encoding helpers
 import json
+from pathlib import Path
 
 def main():
     return os.getcwd()
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [
    {"regions": {"Paired": {"lhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 2, "byte_column": 11}}, "rhs": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 3, "byte_column": 24}}}}, "placeholder": "Imports"}
  ],
  "context": [

  ]
}
```
