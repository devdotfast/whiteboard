; inherits: builtin:core/queries/rust/folds.scm, builtin:core/queries/rust/docstrings.scm
((function_item body: (block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#set! tag "deleted-bodies:function"))
