namespace Orders;

public static class Queue
{
    /// <summary>Hands a queued order to the storage layer.</summary>
    public static OrderRecord QueueOrder(string id) =>
        Storage.SaveOrder(new OrderRecord(id, "queued"));
}
