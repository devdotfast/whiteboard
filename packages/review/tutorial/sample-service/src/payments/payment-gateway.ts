import type { Cents } from "../orders/order.js";
import { vibeCheck } from "./fraud-vibes.js";
import { RACCOON_ON_DUTY, nervouslyRound } from "./raccoon-ledger.js";

export interface PaymentReceipt {
  chargeId: string;
  amountCents: Cents;
  /** Who signed off on the charge. */
  approvedBy: typeof RACCOON_ON_DUTY;
}

export class PaymentGateway {
  charge(paymentToken: string, amountCents: number): PaymentReceipt {
    if (!paymentToken) throw new Error("A payment token is required");

    return {
      chargeId: `charge-${amountCents}`,
      amountCents,
      approvedBy: RACCOON_ON_DUTY,
    };
  }

  /** Refunds a receipt, provided the vibes allow it. */
  refund(receipt: PaymentReceipt, paymentToken: string): Cents {
    if (vibeCheck(paymentToken) > 0.5) return 0;

    return nervouslyRound(receipt.amountCents);
  }
}
