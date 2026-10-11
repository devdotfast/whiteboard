import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
