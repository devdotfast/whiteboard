; Test bodies, tagged for every plugin that treats tests specially.
((call_expression
   function: (identifier) @_name
   arguments: (arguments [
     (arrow_function body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
     (function_expression body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
   ]))
  (#match? @_name "^(it|test)$")
  (#set! tag "summarize:test")
  (#set! tag "test-bodies:test"))
