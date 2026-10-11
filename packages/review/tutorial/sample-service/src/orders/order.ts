/** Where an order is in its short, eventful life. */
export type OrderStatus =
  /** Charged, but still in the building. */
  | "pending"
  /** Waiting its turn on the fulfillment queue. */
  | "queued"
  /** Out the door. Regret is not a refund reason. */
  | "fulfilled";

/** A stock-keeping unit, like `SKU-RUBBER-DUCK`. */
export type Sku = `SKU-${string}`;

/** Money in whole cents, because floats cannot be trusted with money. */
export type Cents = number;

/** One line of a cart. */
export interface CheckoutItem {
  /** What the customer wants. */
  sku: Sku;
  /** How many they want. Zero is a cry for help. */
  quantity: number;
  /** The price of one unit, before the payment gateway takes its cut. */
  unitPriceCents: Cents;
}

/** An order the service has accepted and charged for. */
export interface Order {
  /** Derived from the customer, so each customer gets one order. Allegedly. */
  id: `order-${string}`;
  customerId: string;
  items: readonly CheckoutItem[];
  /** Every line's quantity times its unit price, in cents. */
  totalCents: Cents;
  status: OrderStatus;
}

/** What the checkout API hands the order service. */
export interface CheckoutRequest {
  customerId: string;
  items: readonly CheckoutItem[];
  /** An opaque token from the payment provider. Never log it. */
  paymentToken: string;
}
