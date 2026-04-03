import express from 'express';
const router = express.Router();
import userRouter from './user.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import analyticsRouter from './analytics.js';
import transactionRouter from './transaction.js';

router.use("/users", userRouter);
router.use("/analytics", optionalAuth, analyticsRouter);
router.use("/transactions", optionalAuth, transactionRouter);

export default router;
