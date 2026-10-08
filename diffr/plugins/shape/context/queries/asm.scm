; inherits: builtin:core/queries/asm/folds.scm
; Labels and instructions are siblings, so each is its own scope.
([(label) (instruction)] @fold (#set! tag "context:scope"))

