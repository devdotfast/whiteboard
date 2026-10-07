; Test bodies, tagged for every plugin that treats tests specially.
((function_definition name: (identifier) @_name ":" @fold.open body: (block . (_) @fold.indent) @fold)
  (#match? @_name "^test_")
  (#set! tag "summarize:test")
  (#set! tag "test-bodies:test"))
