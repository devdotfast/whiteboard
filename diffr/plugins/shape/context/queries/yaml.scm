; inherits: builtin:core/queries/yaml/folds.scm
([
  (block_mapping)
  (block_mapping_pair)
  (block_scalar)
  (flow_mapping)
  (flow_sequence)
] @fold (#set! tag "context:scope"))

((block_mapping) @fold (#set! tag "context:open-ended"))
((block_mapping_pair) @fold (#set! tag "context:open-ended"))
((block_sequence . (_) @fold.indent) @fold (#set! tag "context:open-ended"))
((block_sequence_item) @fold (#set! tag "context:open-ended"))
((block_sequence . (_) @fold.indent) @fold (#set! tag "context:body"))

