import express from 'express';
const router = express.Router();
import userRouter from './user.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import analyticsRouter from './analytics.js';
import transactionRouter from './transaction.js';
import {userRateLimiter} from "../middleware/rateLimiter.js";

router.use("/users", userRouter);
router.use("/analytics", optionalAuth, userRateLimiter, analyticsRouter);
router.use("/transactions", optionalAuth, userRateLimiter,transactionRouter);

export default router;
