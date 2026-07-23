import express from 'express';
import { createTransaction, deleteTransaction, getUserTransactions, updateTransaction } from '../controllers/transactions.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { checkOwnerShip } from '../middleware/ownershipMiddleware.js';
import { transactionModel } from '../schema/transaction.js';
import { checkResourceLock } from '../middleware/checkResourceLock.js';

const router = express.Router();

router.get("/", getUserTransactions);
router.post("/", checkResourceLock, createTransaction);
router.patch(
    "/:transactionId",
    validateObjectId({ paramName: "transactionId", type: "params" }),
    checkResourceLock,
    checkOwnerShip({ model: transactionModel, fieldToCheck: "userId" }),
    updateTransaction
);
router.delete(
    "/:transactionId",
    validateObjectId({ paramName: "transactionId", type: "params" }),
    checkResourceLock,
    checkOwnerShip({ model: transactionModel, fieldToCheck: "userId" }),
    deleteTransaction
);

export default router;
