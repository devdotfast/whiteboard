import type { CheckoutItem } from "../orders/order.js";

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
}
