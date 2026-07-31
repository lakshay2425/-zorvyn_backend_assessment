import { balanceCache } from "../controllers/transactions.js";
import { tryAcquireUserLock, releaseUserLock } from "../utilis/balanceCache.js";
import createHttpError from "http-errors";

export const acquireUserLock = (req, res, next) => {
    const userId = req.user.userId;

    if (!tryAcquireUserLock(userId, balanceCache)) {
        return next(createHttpError(409, "Please wait some moments before trying again."));
    }

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        releaseUserLock(userId, balanceCache);
    };

    res.on("finish", release);
    res.on("close", release);

    next();
};
