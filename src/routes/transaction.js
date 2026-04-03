import express from 'express';
import { createTransaction, deleteTransaction, getUserTransactions, updateTransaction } from '../controllers/transactions.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { checkOwnerShip } from '../middleware/ownershipMiddleware.js';
import { transactionModel } from '../schema/transaction.js';
import { checkResourceLock } from '../middleware/checkResourceLock.js';
import { ACTIONS } from '../constants/permissions.js';
import { checkUserPermission } from '../middleware/checkUserPermission.js';
const router = express.Router(); checkUserPermission(ACTIONS.READ_TRANSACTION)
,
router.get("/", checkUserPermission(ACTIONS.READ_TRANSACTION) ,getUserTransactions);
router.post("/", checkUserPermission(ACTIONS.CREATE_TRANSACTION), checkResourceLock, createTransaction);
router.patch("/:transactionId", checkUserPermission(ACTIONS.UPDATE_TRANSACTION), validateObjectId({paramName: "transactionId", type: "params"}), checkResourceLock, checkOwnerShip({model: transactionModel, fieldToCheck: "userId"}), updateTransaction);
router.delete("/:transactionId", checkUserPermission(ACTIONS.DELETE_TRANSACTION), validateObjectId({paramName: "transactionId", type: "params"}), checkResourceLock, checkOwnerShip({model: transactionModel, fieldToCheck: "userId"}), deleteTransaction);

export default router;
