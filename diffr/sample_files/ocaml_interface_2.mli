(** Public interface *)
type result = { value : int; label : string }
val compute : int -> string -> result
