import { balanceCache } from "../controllers/transactions.js";
import { tryAcquireUserLock, releaseUserLock } from "../utilis/balanceCache.js";
import createHttpError from "http-errors";

export const acquireUserLock = (req, res, next) => {
    const userId = req.user.userId;
    const rawKey = req.headers["x-idempotency-key"];
    const idempotencyKey =
        typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : null;

    const result = tryAcquireUserLock(userId, balanceCache, idempotencyKey);

    if (result === "busy") {
        return next(createHttpError(409, "Please wait some moments before trying again."));
    }

    if (result === "same_key") {
        return next();
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
