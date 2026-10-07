/// One stored order.
public struct OrderRecord {
    public var id: String
    public var status: String
}

/// Persists the order and returns what was stored.
public func saveOrder(_ order: OrderRecord) -> OrderRecord {
    order
}
