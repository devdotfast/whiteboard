/// Hands a queued order to the storage layer.
public func queueOrder(id: String) -> OrderRecord {
    let status = "queued"
    return saveOrder(OrderRecord(id: id, status: status))
}
