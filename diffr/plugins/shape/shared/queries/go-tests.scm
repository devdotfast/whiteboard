; Test bodies, tagged for every plugin that treats tests specially.
((function_declaration name: (identifier) @_name body: (block "{" @fold.open (statement_list . [
    (labeled_statement (label_name) . (_) @fold.indent)
    (_) @fold.indent
  ]) "}" @fold.close) @fold)
  (#not-match? @fold.indent "^[A-Za-z_][A-Za-z0-9_]*:\\s*\n")
  (#match? @_name "^Test")
  (#set! tag "summarize:test")
  (#set! tag "test-bodies:test"))
