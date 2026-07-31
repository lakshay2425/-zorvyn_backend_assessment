export const getUserTransactionsService = async (input, dependencies) => {
    const { userId, type, category } = input;
    const { dbOperation, transactionModel } = dependencies;
    const matchQuery = { deletedAt: null, userId };

    if (type) matchQuery.type = type;
    if (category) matchQuery.category = category;

    const allTransactions = await dbOperation(
        () => transactionModel.find(matchQuery).sort({ date: -1 }).lean(),
        "Failed to fetch transactions"
    );

    return {
        success: true,
        message: "Transactions fetched successfully",
        data: { transactions: allTransactions }
    };
};

export const createTransactionService = async (input, dependencies) => {
    const { userId, amount, type, date, category, description, idempotencyKey } = input;
    const { withUserLock, transactionModel, balanceCache, ensureBalanceCache, updateCacheBalance } = dependencies;

    await ensureBalanceCache(userId);

    if (type === "expense" && balanceCache[userId].balance < amount) {
        return {
            success: false,
            message: "Insufficient balance for this expense transaction",
            errorType: 400
        };
    }

    balanceCache[userId].status = "processing";
    balanceCache[userId].lastUpdatedAt = Date.now();

    let transaction;
    try {
        await withUserLock(userId, balanceCache, async () => {
            try {
                transaction = await transactionModel.create({
                    amount,
                    type,
                    date,
                    category,
                    description,
                    userId,
                    idempotencyKey
                });
            } catch (error) {
                if (error?.code === 11000) {
                    const existing = await transactionModel.findOne({ idempotencyKey }).lean();
                    if (existing) {
                        const err = new Error("Idempotency key already processed");
                        err.isIdempotencyReplay = true;
                        err.existingTransaction = existing;
                        throw err;
                    }
                }
                console.error("DB Error: Failed to record the transaction", error.message);
                const wrapped = new Error("Failed to record the transaction");
                wrapped.statusCode = 500;
                throw wrapped;
            }
            await updateCacheBalance(userId, amount, type);
        });
    } catch (error) {
        if (error?.isIdempotencyReplay) {
            return {
                success: true,
                replay: true,
                message: "This transaction has already been processed",
                data: {
                    transactionID: error.existingTransaction._id,
                    transactionData: error.existingTransaction
                }
            };
        }
        throw error;
    }

    return {
        success: true,
        replay: false,
        message: "Transaction created successfully",
        data: { transactionID: transaction._id, transactionData: transaction }
    };
};

export const updateTransactionService = async (input, dependencies) => {
    const { userId, transaction, payload } = input;
    const { dbOperation, withUserLock, transactionModel, balanceCache, ensureBalanceCache, updateCacheBalance } = dependencies;

    await ensureBalanceCache(userId);
    balanceCache[userId].status = "processing";
    balanceCache[userId].lastUpdatedAt = Date.now();

    const { _id: transactionId, amount, type } = transaction;
    const allowedFields = ["amount", "category", "description"];
    let isAmountUpdated = false;
    const updateData = {};
    for (const field of allowedFields) {
        if (payload[field] !== undefined) {
            updateData[field] = payload[field];
            if (field === "amount") {
                isAmountUpdated = true;
            }
        }
    }

    if (Object.keys(updateData).length === 0) {
        return {
            success: false,
            message: "No valid fields provided for update",
            errorType: 400
        };
    }

    let updatedTransaction;
    await withUserLock(userId, balanceCache, async () => {
        updatedTransaction = await dbOperation(() => {
            return transactionModel.findOneAndUpdate(
                { _id: transactionId, userId },
                { $set: updateData },
                { new: true }
            );
        }, "Failed to update the transaction record");
        if (isAmountUpdated) {
            const amountDifference = payload.amount - amount;
            await updateCacheBalance(userId, amountDifference, type);
        }
    });

    return {
        success: true,
        message: "Transaction updated successfully",
        data: { transactionID: updatedTransaction._id, transactionData: updatedTransaction }
    };
};

export const deleteTransactionService = async (input, dependencies) => {
    const { transaction } = input;
    const { dbOperation, withUserLock, transactionModel, balanceCache, ensureBalanceCache, updateCacheBalance } = dependencies;

    if (transaction.deletedAt !== null) {
        return {
            success: false,
            message: "This transaction has already been deleted",
            errorType: 400
        };
    }

    const userId = transaction.userId;
    await ensureBalanceCache(userId);
    balanceCache[userId].status = "processing";
    balanceCache[userId].lastUpdatedAt = Date.now();

    await withUserLock(userId, balanceCache, async () => {
        await dbOperation(
            () => transactionModel.findOneAndUpdate(
                { _id: transaction._id, userId },
                { $set: { deletedAt: new Date() } },
                { new: true }
            ),
            "Failed to delete the transaction record"
        );
        await updateCacheBalance(userId, -transaction.amount, transaction.type);
    });

    return {
        success: true,
        message: "Transaction deleted successfully"
    };
};
