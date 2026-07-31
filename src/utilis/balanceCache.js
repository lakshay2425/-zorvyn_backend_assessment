export function tryAcquireUserLock(userId, balanceCache) {
    const entry = balanceCache[userId];
    if (entry?.status === "processing") {
        return false;
    }

    if (entry) {
        entry.status = "processing";
        entry.lastUpdatedAt = Date.now();
    } else {
        balanceCache[userId] = {
            status: "processing",
            lastUpdatedAt: Date.now(),
        };
    }

    return true;
}

export function releaseUserLock(userId, balanceCache) {
    if (balanceCache[userId]) {
        balanceCache[userId].status = "idle";
    }
}

export const ensureBalanceCache = async (userId, balanceCache, transactionModel, mongoose) => {
    if (balanceCache[userId]?.balance !== undefined) {
        return balanceCache[userId];
    }

    const userBalance = await transactionModel.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), deletedAt: null } },
        { $group: { _id: "$type", totalAmount: { $sum: "$amount" } } }
    ]);
    const income = userBalance.find(b => b._id === "income")?.totalAmount ?? 0;
    const expense = userBalance.find(b => b._id === "expense")?.totalAmount ?? 0;

    const existing = balanceCache[userId];
    balanceCache[userId] = {
        balance: income - expense,
        status: existing?.status ?? "idle",
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
