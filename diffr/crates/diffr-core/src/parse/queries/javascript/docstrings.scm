; Documentation association is captured here, not inferred by plugin traversal.
((comment)+ @fold @related.documentation
  .
  [
    (function_declaration)
    (generator_function_declaration)
    (method_definition)
    (lexical_declaration)
    (variable_declaration)
    (export_statement)
  ])
((comment)+ @fold @related.documentation
  .
  [
    (function_declaration body: (statement_block) @related.from)
    (generator_function_declaration body: (statement_block) @related.from)
    (method_definition body: (statement_block) @related.from)
    (export_statement
      declaration: [
        (function_declaration body: (statement_block) @related.from)
        (generator_function_declaration body: (statement_block) @related.from)
      ])
    (lexical_declaration
      (variable_declarator
        value: [
          (arrow_function body: (statement_block) @related.from)
          (function_expression body: (statement_block) @related.from)
        ]))
    (variable_declaration
      (variable_declarator
        value: [
          (arrow_function body: (statement_block) @related.from)
          (function_expression body: (statement_block) @related.from)
        ]))
  ]
  (#match? @related.from "\n")
  (#set! tag "deleted-bodies:docstring")
  (#set! tag "summarize:docstring")
  (#set! tag "test-bodies:docstring"))
