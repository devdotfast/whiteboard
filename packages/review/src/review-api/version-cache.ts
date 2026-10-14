interface Version {
  reviewId: string;
  version: number;
}

/** A stored version never changes, so work derived from it runs once. Keeps
 * the `capacity` most recently used results. */
export class VersionCache<Input extends Version, Result> {
  private readonly results = new Map<string, Result>();

  constructor(
    private readonly derive: (input: Input) => Result,
    private readonly options: {
      capacity: number;
      /** For input whose content a version alone does not pin down. */
      key?: (input: Input) => string;
    },
  ) {}

  get(input: Input): Result {
    const key =
      this.options.key?.(input) ?? `${input.reviewId}\0${input.version}`;

    const cached = this.results.get(key);
    const result = cached ?? this.derive(input);

    // Most recently used last, so the oldest goes first.
    this.results.delete(key);

    if (this.results.size >= this.options.capacity)
      this.results.delete(this.results.keys().next().value!);
    this.results.set(key, result);

    return result;
  }
}
