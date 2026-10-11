import type { Cents } from "../orders/order.js";

/** The ledger is kept by a raccoon. It has never been audited. */
export const RACCOON_ON_DUTY = "Gerald";

/** Rounds to the nearest cent, then rounds again out of anxiety. */
export function nervouslyRound(cents: Cents): Cents {
  return Math.round(Math.round(cents));
}
