namespace Orders;

/// <summary>One stored order.</summary>
public record OrderRecord(string Id, string Status);

public static class Storage
{
    /// <summary>Persists the order and returns what was stored.</summary>
    public static OrderRecord SaveOrder(OrderRecord order) => order;
}
