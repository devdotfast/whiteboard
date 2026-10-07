; inherits: builtin:core/queries/javascript/folds.scm
((function_declaration body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#set! tag "removed-runs:function"))
((generator_function_declaration body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#set! tag "removed-runs:function"))
((method_definition body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#set! tag "removed-runs:function"))
((variable_declarator
   name: (identifier)
   value: [
     (arrow_function body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
     (function_expression body: (statement_block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
   ])
  (#set! tag "removed-runs:function"))
