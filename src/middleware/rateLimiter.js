import rateLimit from 'express-rate-limit';
import createHttpError from 'http-errors';

export const userRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, 
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.user?.userId; 
    },
    handler: (req, res, next) => {
        return next(createHttpError(429, "Too many requests. Please try again later."));
    }
});
