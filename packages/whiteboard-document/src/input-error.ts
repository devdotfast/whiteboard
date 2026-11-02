/** Deliberately safe to show to API clients, unlike filesystem/provider errors. */
export class ReviewInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 426 = 400,
  ) {
    super(message);
  }
}
