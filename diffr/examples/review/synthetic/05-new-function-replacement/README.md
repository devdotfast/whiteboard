# 05-new-function-replacement

A manually supplied replacement spans several added statements. The new function signature stays visible outside the fold. No extra signature context is necessary because it is already added code. Generating this placeholder is not part of v0 fold detection.

```diff
diff --git a/before.py b/after.py
index b3eb7257..4197591b 100644
--- a/before.py
+++ b/after.py
@@ -1,2 +1,9 @@
 def main():
     return 1
+
+
+def enqueue(items, queue):
+    for item in items:
+        if item is None:
+            continue
+        queue.append(item)
```

Expected annotations (hand-authored target behavior):

```json
{
  "folds": [
    {"regions": {"Added": {"start": {"line": 5, "byte_column": 0}, "end": {"line": 8, "byte_column": 26}}}, "placeholder": "Skip missing items and enqueue the rest."}
  ],
  "context": [

  ]
}
```
