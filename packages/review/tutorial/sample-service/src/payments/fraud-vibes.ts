/** A fraud score derived entirely from vibes: 0 is chill, 1 is not. */
export function vibeCheck(paymentToken: string): number {
  return paymentToken.startsWith("tok_sus") ? 1 : 0;
}
