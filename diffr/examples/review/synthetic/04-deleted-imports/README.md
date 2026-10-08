# 04-deleted-imports

Only the base side has an import section. Expanding or collapsing it does not manufacture an opposite fold.

```diff
diff --git a/before.py b/after.py
index f0f3a4bb..b3eb7257 100644
--- a/before.py
+++ b/after.py
@@ -1,5 +1,2 @@
-import os
-import sys
-
 def main():
     return 1
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [
    {"regions": {"Deleted": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 1, "byte_column": 10}}}, "placeholder": "Imports"}
  ],
  "context": [

  ]
}
```
