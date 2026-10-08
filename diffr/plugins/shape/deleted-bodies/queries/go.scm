; inherits: builtin:core/queries/go/folds.scm, builtin:core/queries/go/docstrings.scm
((function_declaration body: (block "{" @fold.open (statement_list . [
    (labeled_statement (label_name) . (_) @fold.indent)
    (_) @fold.indent
  ]) "}" @fold.close) @fold)
  (#not-match? @fold.indent "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n")
  (#set! tag "deleted-bodies:function"))
((method_declaration body: (block "{" @fold.open (statement_list . [
    (labeled_statement (label_name) . (_) @fold.indent)
    (_) @fold.indent
  ]) "}" @fold.close) @fold)
  (#not-match? @fold.indent "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n")
  (#set! tag "deleted-bodies:function"))
