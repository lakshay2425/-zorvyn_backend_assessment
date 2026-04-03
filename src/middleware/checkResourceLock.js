import { balanceCache } from "../controllers/transactions.js";
import createHttpError from "http-errors";

export const checkResourceLock = (req, res, next) => {
    const userId = req.user.userId;
    const userBalanceInfo = balanceCache[userId];
    if (userBalanceInfo && userBalanceInfo.status === "processing") {
        return next(createHttpError(409, "Please wait some moments before trying again."));
    }
    next();
}
