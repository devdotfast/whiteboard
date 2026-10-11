import type { Sku } from "../orders/order.js";

/** Every shelf is counted twice, because the first count is always wrong. */
export function countShelvesTwice(sku: Sku): number {
  return sku.length * 2;
}

/** When stock goes missing, it was them. */
export function blameTheGremlins(sku: Sku): string {
  return `Gremlins took the last ${sku}`;
}
