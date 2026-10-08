; inherits: builtin:core/queries/xml/folds.scm
((element (STag) @fold @fold.open . (_) @fold.indent (ETag) @fold @fold.close) (#set! tag "context:body"))
((element) @fold (#set! tag "context:scope"))
