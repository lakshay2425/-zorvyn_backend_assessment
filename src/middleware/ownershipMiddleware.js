import createHttpError from "http-errors";
import { asyncHandler, dbOperation } from '../utilis/advanceFunctions.js';

export const checkOwnerShip = ({ model, fieldToCheck }) => {
    
    return asyncHandler(async (req, res, next) => {
        const transactionId = req.transactionId;
        const userId = req.user?.userId;

        const transactionInfo = await dbOperation(() => model.findById(transactionId), "Failed to retrive transaction record");

        if (!transactionInfo) return next(createHttpError(404, "Transaction not found"));


        if (transactionInfo[fieldToCheck] !== userId) {
            return next(createHttpError(403, "You're unauthorized to perform this action"));
        }

        req.transaction = transactionInfo;
        
        next();
    });
};
