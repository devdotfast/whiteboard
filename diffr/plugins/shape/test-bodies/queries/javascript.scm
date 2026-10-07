; inherits: builtin:core/queries/javascript/folds.scm, builtin:core/queries/javascript/docstrings.scm, builtin:shared/queries/javascript-tests.scm
((call_expression
   function: (identifier) @_name
   arguments: (arguments [
     (arrow_function body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
     (function_expression body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
   ]))
  (#match? @_name "^describe$")
  (#set! tag "test-bodies:test"))
