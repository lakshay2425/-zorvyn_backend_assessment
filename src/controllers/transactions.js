import { transactionModel } from '../schema/transaction.js';
import { dbOperation, withUserLock } from '../utilis/advanceFunctions.js';
import { transactionSchema, updateTransactionSchema, idempotencyHeaderSchema, getTransactionsQuerySchema } from '../validationSchemas/transaction.js';
import { returnResponse } from '../utilis/returnResponse.js';
import createHttpError from 'http-errors';
import mongoose from 'mongoose';
import { createTransactionService, deleteTransactionService, getUserTransactionsService, updateTransactionService } from '../services/transaction.js';

export const balanceCache = {} // Structure: { userId: { balance: Number, status: "processing" | "idle", lastUpdatedAt: Number } }

export const getUserTransactions = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const validatedQuery = getTransactionsQuerySchema.safeParse(req.query);
        if (!validatedQuery.success) {
            return next(createHttpError(400, "Invalid query parameters"));
        }

        const transactionInfo = await getUserTransactionsService(
            {
                userId,
                type: validatedQuery.data.type?.toLowerCase(),
                category: validatedQuery.data.category
            },
            { dbOperation, transactionModel }
        );

        if (!transactionInfo.success) {
            return next(createHttpError(transactionInfo.errorType || 500, transactionInfo.message));
        }

        returnResponse(transactionInfo.message, res, 200, transactionInfo.data);
    } catch (error) {
        next(error);
    }
}

export const createTransaction = async (req, res, next) => {
    try {
        const idempotencyValidation = idempotencyHeaderSchema.safeParse({ idempotencyKey: req.headers["x-idempotency-key"] });
        if (!idempotencyValidation.success) {
            return next(createHttpError(400, "Missing or invalid x-idempotency-key header"));
        }
        const idempotencyKey = idempotencyValidation.data.idempotencyKey;

        const existingTransaction = await dbOperation(
            () => transactionModel.findOne({ idempotencyKey }).lean(),
            "Failed to check idempotency key"
        );

        if (existingTransaction) {
            return returnResponse(
                "This transaction has already been processed",
                res,
                200,
                {
                    transactionID: existingTransaction._id,
                    transactionData: existingTransaction
                },
                { "Idempotency-Replay": "true" }
            );
        }

        const validatedData = transactionSchema.safeParse(req.body);
        if (!validatedData.success) {
            return next(createHttpError(400, "Invalid data"));
        }

        const userId = req.user.userId;
        const transactionInfo = await createTransactionService(
            {
                userId,
                idempotencyKey,
                ...validatedData.data
            },
            {
                dbOperation,
                withUserLock,
                transactionModel,
                mongoose,
                balanceCache,
                updateCacheBalance
            }
        );

        if (!transactionInfo.success) {
            return next(createHttpError(transactionInfo.errorType || 500, transactionInfo.message));
        }

        if (transactionInfo.replay) {
            return returnResponse(
                transactionInfo.message,
                res,
                200,
                transactionInfo.data,
                { "Idempotency-Replay": "true" }
            );
        }

        returnResponse(transactionInfo.message, res, 201, transactionInfo.data);
    } catch (error) {
        next(error);
    }
};

export const deleteTransaction = async (req, res, next) => {
    try {
        const transactionInfo = await deleteTransactionService(
            { transaction: req.transaction },
            {
                dbOperation,
                withUserLock,
                transactionModel,
                balanceCache,
                updateCacheBalance
            }
        );
        if (!transactionInfo.success) {
            return next(createHttpError(transactionInfo.errorType || 500, transactionInfo.message));
        }

        returnResponse(transactionInfo.message, res, 200);
    } catch (error) {
        next(error);
    }
}

export const updateTransaction = async (req, res, next) => {
    try {
        const validatedData = updateTransactionSchema.safeParse(req.body);
        if (!validatedData.success) {
            return next(createHttpError(400, 'Invalid data'));
        }

        const userId = req.user.userId;
        const transactionInfo = await updateTransactionService(
            {
                userId,
                transaction: req.transaction,
                payload: validatedData.data
            },
            {
                dbOperation,
                withUserLock,
                transactionModel,
                balanceCache,
                updateCacheBalance
            }
        );

        if (!transactionInfo.success) {
            return next(createHttpError(transactionInfo.errorType || 500, transactionInfo.message));
        }

        returnResponse(transactionInfo.message, res, 200, transactionInfo.data);
    } catch (error) {
        next(error);
    }
}

const updateCacheBalance = async (userId, amount, type) => {
    balanceCache[userId] ||= { balance: 0, status: "idle", lastUpdatedAt: Date.now() };
    if (type === "expense") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) - amount;
    } else if (type === "income") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) + amount;
    }
    balanceCache[userId].lastUpdatedAt = Date.now();
}
