import express from 'express';
const router = express.Router();
import userRouter from './user.js';
// import analyticsRouter from './analytics.js';
// import transactionRouter from './transaction.js';

router.use("/users", userRouter);
// router.use("/analytics", analyticsRouter);
// router.use("/transaction", transactionRouter);

export default router;
