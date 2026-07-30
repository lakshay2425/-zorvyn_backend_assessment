import createHttpError from "http-errors";
import { dbOperation } from '../utilis/advanceFunctions.js';

export const checkOwnerShip = ({ model, fieldToCheck }) => {

    return async (req, res, next) => {
        try {
            const transactionId = req.transactionId;
            const userId = req.user?.userId;

            const transactionInfo = await dbOperation(() => model.findById(transactionId), "Failed to retrive transaction record");

            if (!transactionInfo) return next(createHttpError(404, "Transaction not found"));

            const recordOwnerId = transactionInfo[fieldToCheck]?.toString();
            const authenticatedUserId = userId?.toString();

            const isOwner = recordOwnerId === authenticatedUserId;
            if (!isOwner) {
                return next(createHttpError(403, "You're unauthorized to perform this action"));
            }

            req.transaction = transactionInfo;

            next();
        } catch (error) {
            next(error);
        }
    };
};
