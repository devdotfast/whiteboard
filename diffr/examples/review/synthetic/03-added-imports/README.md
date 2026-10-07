# 03-added-imports

Only the head side has an import section. Collapsing it must not hide any base source.

```diff
diff --git a/before.py b/after.py
index b3eb7257..f0f3a4bb 100644
--- a/before.py
+++ b/after.py
@@ -1,2 +1,5 @@
+import os
+import sys
+
 def main():
     return 1
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [
    {"regions": {"Added": {"start": {"line": 0, "byte_column": 0}, "end": {"line": 1, "byte_column": 10}}}, "placeholder": "Imports"}
  ],
  "context": [

  ]
}
```
