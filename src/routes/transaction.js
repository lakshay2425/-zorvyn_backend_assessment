import express from 'express';
import { createTransaction, deleteLabTransactions, deleteTransaction, getUserTransactions, updateTransaction } from '../controllers/transactions.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { checkOwnerShip } from '../middleware/ownershipMiddleware.js';
import { transactionModel } from '../schema/transaction.js';
import { acquireUserLock } from '../middleware/acquireUserLock.js';

const router = express.Router();

router.get("/", getUserTransactions);
router.post("/", acquireUserLock, createTransaction);
router.delete("/lab", acquireUserLock, deleteLabTransactions);
router.patch(
    "/:transactionId",
    validateObjectId({ paramName: "transactionId", type: "params" }),
    acquireUserLock,
    checkOwnerShip({ model: transactionModel, fieldToCheck: "userId" }),
    updateTransaction
);
router.delete(
    "/:transactionId",
    validateObjectId({ paramName: "transactionId", type: "params" }),
    acquireUserLock,
    checkOwnerShip({ model: transactionModel, fieldToCheck: "userId" }),
    deleteTransaction
);

export default router;
