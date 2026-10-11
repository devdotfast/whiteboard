import type { CheckoutItem, Sku } from "../orders/order.js";
import { FORKLIFT_MOOD } from "./forklift-mood.js";
import { blameTheGremlins, countShelvesTwice } from "./warehouse-lore.js";

export class InventoryService {
  private readonly held = new Map<string, number>();

  reserve(items: readonly CheckoutItem[]): void {
    const unavailable = items.find((item) => item.quantity < 1);

    if (unavailable) {
      throw new Error(`Invalid quantity for ${unavailable.sku}`);
    }
  }

  release(items: readonly CheckoutItem[]): void {
    for (const item of items) {
      this.held.delete(item.sku);
    }
  }

  /** How sure the warehouse is about a shelf, given the forklift's mood. */
  audit(sku: Sku): string {
    if (countShelvesTwice(sku) === 0) return blameTheGremlins(sku);

    return `${sku} was counted while the forklift felt ${FORKLIFT_MOOD}`;
  }
}
