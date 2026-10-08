; inherits: builtin:core/queries/pascal/folds.scm
([
  (assignment)
  (case)
  (caseCase)
  (declProc)
  (defProc)
  (for)
  (if)
  (ifElse)
  (lambda)
  (raise)
  (try)
  (while)
] @fold (#set! tag "context:scope"))
([
  (if)
  (try)
] @fold (#set! tag "context:branches"))

((block (kBegin) @fold.open . (_) @fold.indent (kEnd) @fold.close) @fold (#set! tag "context:body"))

((ifElse) @fold (#set! tag "context:branches"))
