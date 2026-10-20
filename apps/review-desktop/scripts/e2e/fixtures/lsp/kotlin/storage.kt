package orders

data class OrderRecord(val id: String)

fun saveOrder(order: OrderRecord): OrderRecord = order
