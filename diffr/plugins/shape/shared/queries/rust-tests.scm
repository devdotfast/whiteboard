; Test bodies, tagged for every plugin that treats tests specially.
((function_item attributes: (attributes (attribute_item) @_attribute) body: (block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#match? @_attribute "test")
  (#set! tag "summarize:test")
  (#set! tag "test-bodies:test"))
