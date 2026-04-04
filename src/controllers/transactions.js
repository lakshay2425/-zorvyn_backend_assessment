import { transactionModel } from '../schema/transaction.js';
import { asyncHandler, dbOperation, withUserLock } from '../utilis/advanceFunctions.js';
import { transactionSchema, updateTransactionSchema } from '../validationSchemas/transaction.js';
import { returnResponse } from '../utilis/returnResponse.js';
import createHttpError from 'http-errors';
import mongoose from 'mongoose';
import { response } from 'express';

export const proccessedTransactionKeys = {} // Structure: { idempotencyKey: { status: "processing" | "processed" , responseData: {}} }
export const balanceCache = {} // Structure: { userId: { balance: Number, status: "processing" | "idle" } }

export const getUserTransactions = asyncHandler(async (req, res, next) => {
    const userId = req.user.userId;
    const isAdmin = false; // This will be extracted from my role based access control logic middleware
    const matchQuery = { deletedAt: null };
    if (req.query.type) {
        const type = req.query.type.toLowerCase();
        const validTypes = ["income", "expense"];

        if (!validTypes.includes(type)) {
            return next(createHttpError(400, "Invalid transaction type."));
        }
        matchQuery.type = type;
    }

    if (req.query?.category) matchQuery.category = req.query.category;
    if (!isAdmin) matchQuery.userId = userId;

    const allTransactions = await dbOperation(() => transactionModel.find(matchQuery).sort({ date: -1 }).lean(), "Failed to fetch transactions");

    returnResponse("Transactions fetched successfully", res, 200, { transactions: allTransactions });
})


export const createTransaction = asyncHandler(async (req, res, next) => {
    const idempotencyKey = req.headers["x-idempotency-key"];
    const isAlreadyProcessed = proccessedTransactionKeys[idempotencyKey];

    if (isAlreadyProcessed && (isAlreadyProcessed.status === "processed" || isAlreadyProcessed.status === "processing")) {
        return returnResponse("This transaction is already being processed or has been processed", res, 200, { ...isAlreadyProcessed.responseData }, { "Idempotency-Replay": "true" });
    }

    const validatedData = transactionSchema.safeParse(req.body);
    if (!validatedData.success) {
        return next(createHttpError(400, `Invalid data`));
    }

    const { amount, type, date, category, description } = validatedData.data;
    const userId = req.user.userId;

    if (type === 'expense') {
        const cachedEntry = balanceCache[userId];
        if (cachedEntry) {
            if (cachedEntry.balance < amount) {
                return next(createHttpError(400, "Insufficient balance for this expense transaction"));
            }
            balanceCache[userId].status = "processing";
        } else {
            // Cache miss — derive balance from DB
            const userBalance = await transactionModel.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId), deletedAt: null } },
                { $group: { _id: "$type", totalAmount: { $sum: "$amount" } } }
            ]);
            const income = userBalance.find(b => b._id === "income")?.totalAmount ?? 0;
            const expense = userBalance.find(b => b._id === "expense")?.totalAmount ?? 0;
            const currentBalance = income - expense;
            if (currentBalance < amount) {
                balanceCache[userId] = { balance: currentBalance, status: "idle" };
                proccessedTransactionKeys[idempotencyKey] = { status: "idle", responseData: { message: "Insufficient balance for this expense transaction" } };
                return next(createHttpError(400, "Insufficient balance for this expense transaction"));
            }
            balanceCache[userId] = { balance: currentBalance, status: "processing" };
        }
    }
    await withUserLock(userId, balanceCache, async () => {
        const transaction = await dbOperation(() => transactionModel.create({ amount, type, date, category, description, userId }), "Failed to record the transaction");
        proccessedTransactionKeys[idempotencyKey] = { status: "processed", responseData: { transactionID: transaction._id, transactionData: transaction } };
        updateCacheBalance(userId, amount, type);

        returnResponse("Transaction created successfully", res, 201, { transactionID: transaction._id, transactionData: transaction });
    })
});


export const deleteTransaction = asyncHandler(async (req, res, next) => {
    const transaction = req.transaction;

    if (transaction.deletedAt !== null) {
        return next(createHttpError(400, "This transaction has already been deleted"));
    }

    const userId = transaction.userId;

    // transaction.deletedAt = new Date();
    await withUserLock(userId, balanceCache, async () => {
        await dbOperation(() => transactionModel.findOneAndUpdate(
            { _id: transaction._id, userId },
            { $set: { deletedAt: new Date() } },
            { new: true }
        ), "Failed to delete the transaction record");
        updateCacheBalance(userId, -transaction.amount, transaction.type);
        returnResponse("Transaction deleted successfully", res, 200);
    })
})

export const updateTransaction = asyncHandler(async (req, res, next) => {
    const validatedData = updateTransactionSchema.safeParse(req.body);

    if (!validatedData.success) {
        return next(createHttpError(400, 'Invalid data'));
    }

    const userId = req.user.userId;
    balanceCache[userId] ||= { balance: 0, status: "idle" };
    balanceCache[userId].status = "processing";
    const { _id: transactionId, amount, type } = req.transaction;

    const allowedFields = ["amount", "category", "description"];
    let isAmountUpdated = false;
    const updateData = {};
    for (const field of allowedFields) {
        if (validatedData.data[field] !== undefined) {
            updateData[field] = validatedData.data[field];
            if (field === "amount") {
                isAmountUpdated = true;
            }
        }
    }
    if (Object.keys(updateData).length === 0) return next(createHttpError(400, "No valid fields provided for update"));

    await withUserLock(userId, balanceCache, async () => {
        const updatedTransaction = await dbOperation(() => {
            return transactionModel.findOneAndUpdate(
                { _id: transactionId, userId },
                { $set: updateData },
                { new: true }
            );
        }, "Failed to update the transaction record");
        if (isAmountUpdated) {
            const amountDifference = validatedData.data.amount - amount;
            updateCacheBalance(userId, amountDifference, type);
        }
        returnResponse("Transaction updated successfully", res, 200, { transactionID: updatedTransaction._id, transactionData: updatedTransaction });
    })
})

const updateCacheBalance = async (userId, amount, type) => {
    balanceCache[userId] ||= { balance: 0 };
    if (type === "expense") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) - amount;
    } else if (type === "income") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) + amount;
    }
}
