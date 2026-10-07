; inherits: builtin:core/queries/go/folds.scm, builtin:core/queries/go/docstrings.scm, builtin:shared/queries/go-tests.scm
((function_declaration name: (identifier) @_name body: (block "{" @fold.open (statement_list .
    (if_statement condition: (call_expression function: (selector_expression) @_short)) @fold.indent) "}" @fold.close) @fold)
  (#match? @_name "^Test")
  (#eq? @_short "testing.Short")
  (#set! tag "test-bodies:integration"))
