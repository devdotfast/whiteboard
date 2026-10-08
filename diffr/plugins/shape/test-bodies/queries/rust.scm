; inherits: builtin:core/queries/rust/folds.scm, builtin:core/queries/rust/docstrings.scm, builtin:shared/queries/rust-tests.scm
((mod_item attributes: (attributes (attribute_item) @_attribute) body: (declaration_list "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold)
  (#match? @_attribute "cfg\\(test\\)")
  (#set! tag "test-bodies:module"))
