; inherits: ../javascript/folds.scm
; TypeScript adds type declarations to the JavaScript structure: an
; interface, an object type and an enum fold their bodies like a block.
[
  (interface_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (object_type "{" @fold.open . (_) @fold.indent "}" @fold.close)
  (enum_body "{" @fold.open . (_) @fold.indent "}" @fold.close)
] @fold
