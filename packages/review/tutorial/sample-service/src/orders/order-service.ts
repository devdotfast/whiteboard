import type { InventoryService } from "../inventory/inventory-service.js";
import type { PaymentGateway } from "../payments/payment-gateway.js";
import type { Cents, CheckoutRequest, Order } from "./order.js";
import type { OrdersRepository } from "./orders-repository.js";

export class OrderService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly payments: PaymentGateway,
    private readonly orders: OrdersRepository,
  ) {}

  /** Reserves the stock, charges the customer, and saves a pending order. */
  placeOrder(request: CheckoutRequest): Order {
    const totalCents: Cents = request.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceCents,
      0,
    );

    this.inventory.reserve(request.items);
    this.payments.charge(request.paymentToken, totalCents);

    const order: Order = {
      id: `order-${request.customerId}`,
      customerId: request.customerId,
      items: request.items,
      totalCents,
      status: "pending",
    };

    this.orders.insert(order);

    return order;
  }
}
