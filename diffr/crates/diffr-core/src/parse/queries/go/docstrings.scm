; Documentation association is captured here, not inferred by plugin traversal.
((comment)+ @fold @related.documentation . [(function_declaration) (method_declaration)])
((comment)+ @fold @related.documentation
  .
  [
    (function_declaration body: (block) @related.from)
    (method_declaration body: (block) @related.from)
  ]
  (#match? @related.from "\n")
  (#set! tag "deleted-bodies:docstring")
  (#set! tag "summarize:docstring")
  (#set! tag "test-bodies:docstring"))
