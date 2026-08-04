/**
 * @returns {"acquired" | "same_key" | "busy"}
 */
export function tryAcquireUserLock(userId, balanceCache, idempotencyKey = null) {
    const entry = balanceCache[userId];

    if (entry?.status === "processing") {
        if (
            idempotencyKey &&
            entry.processingIdempotencyKey &&
            entry.processingIdempotencyKey === idempotencyKey
        ) {
            return "same_key";
        }
        return "busy";
    }

    if (entry) {
        entry.status = "processing";
        entry.processingIdempotencyKey = idempotencyKey;
        entry.lastUpdatedAt = Date.now();
    } else {
        balanceCache[userId] = {
            status: "processing",
            processingIdempotencyKey: idempotencyKey,
            lastUpdatedAt: Date.now(),
        };
    }

    return "acquired";
}

export function releaseUserLock(userId, balanceCache) {
    if (balanceCache[userId]) {
        balanceCache[userId].status = "idle";
        balanceCache[userId].processingIdempotencyKey = null;
    }
}

export const ensureBalanceCache = async (userId, balanceCache, transactionModel, mongoose) => {
    if (balanceCache[userId]?.balance !== undefined) {
        return balanceCache[userId];
    }

    const userBalance = await transactionModel.aggregate([
        { $match: { userId: userId, deletedAt: null } },
        { $group: { _id: "$type", totalAmount: { $sum: "$amount" } } }
    ]);
    const income = userBalance.find(b => b._id === "income")?.totalAmount ?? 0;
    const expense = userBalance.find(b => b._id === "expense")?.totalAmount ?? 0;

    const existing = balanceCache[userId];
    balanceCache[userId] = {
        balance: income - expense,
        status: existing?.status ?? "idle",
        processingIdempotencyKey: existing?.processingIdempotencyKey ?? null,
        lastUpdatedAt: Date.now(),
    };

    return balanceCache[userId];
};

export const updateCacheBalance = async (userId, amount, type, balanceCache, transactionModel, mongoose) => {
    await ensureBalanceCache(userId, balanceCache, transactionModel, mongoose);

    if (type === "expense") {
        balanceCache[userId].balance -= amount;
    } else if (type === "income") {
        balanceCache[userId].balance += amount;
    }

    balanceCache[userId].lastUpdatedAt = Date.now();
};
