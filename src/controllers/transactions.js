import { transactionModel } from '../schema/transaction.js';
import { asyncHandler, dbOperation, withUserLock } from '../utilis/advanceFunctions.js';
import { transactionSchema, updateTransactionSchema, idempotencyHeaderSchema, getTransactionsQuerySchema } from '../validationSchemas/transaction.js';
import { returnResponse } from '../utilis/returnResponse.js';
import createHttpError from 'http-errors';
import mongoose from 'mongoose';
import { createTransactionService, deleteTransactionService, getUserTransactionsService, updateTransactionService } from '../services/transaction.js';

export const proccessedTransactionKeys = {} // Structure: { idempotencyKey: { status: "processing" | "processed" , responseData: {}} }
export const balanceCache = {} // Structure: { userId: { balance: Number, status: "processing" | "idle" } }

export const getUserTransactions = asyncHandler(async (req, res, next) => {
    const userId = req.user.userId;
    const role = req.user.role;
    const isAdmin = role === "admin" || role === "analyst";
    const validatedQuery = getTransactionsQuerySchema.safeParse(req.query);
    if (!validatedQuery.success) {
        return next(createHttpError(400, "Invalid query parameters"));
    }

    const transactionInfo = await getUserTransactionsService(
        {
            userId,
            isAdmin,
            type: validatedQuery.data.type?.toLowerCase(),
            category: validatedQuery.data.category
        },
        { dbOperation, transactionModel }
    );

    if (!transactionInfo.success) {
        return next(createHttpError(transactionInfo.errorType || 500, transactionInfo.message));
    }

    returnResponse(transactionInfo.message, res, 200, transactionInfo.data);
})

export const createTransaction = asyncHandler(async (req, res, next) => {
    const idempotencyValidation = idempotencyHeaderSchema.safeParse({ idempotencyKey: req.headers["x-idempotency-key"] });
    if (!idempotencyValidation.success) {
        return next(createHttpError(400, "Missing or invalid x-idempotency-key header"));
    }
    const idempotencyKey = idempotencyValidation.data.idempotencyKey;
    const isAlreadyProcessed = proccessedTransactionKeys[idempotencyKey];

    if (isAlreadyProcessed && (isAlreadyProcessed.status === "processed" || isAlreadyProcessed.status === "processing")) {
        return returnResponse("This transaction is already being processed or has been processed", res, 200, { ...isAlreadyProcessed.responseData }, { "Idempotency-Replay": "true" });
    }

    const validatedData = transactionSchema.safeParse(req.body);
    if (!validatedData.success) {
        return next(createHttpError(400, "Invalid data"));
    }

    const userId = req.user.userId;
    const transactionInfo = await createTransactionService(
        {
            userId,
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

    proccessedTransactionKeys[idempotencyKey] = { status: "processed", responseData: transactionInfo.data };
    returnResponse(transactionInfo.message, res, 201, transactionInfo.data);
});

export const deleteTransaction = asyncHandler(async (req, res, next) => {
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
})

export const updateTransaction = asyncHandler(async (req, res, next) => {
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
})

const updateCacheBalance = async (userId, amount, type) => {
    balanceCache[userId] ||= { balance: 0 };
    if (type === "expense") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) - amount;
    } else if (type === "income") {
        balanceCache[userId]["balance"] = (balanceCache[userId]?.balance ?? 0) + amount;
    }
}

