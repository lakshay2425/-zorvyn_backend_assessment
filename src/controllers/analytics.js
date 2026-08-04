import { dbOperation } from "../utilis/advanceFunctions.js"
import { transactionModel } from "../schema/transaction.js"
import { returnResponse } from "../utilis/returnResponse.js";
import { getAnalyticsService } from "../services/analytics.js";
import mongoose from "mongoose";

export const getAnalytics = async (req, res, next) => {
    try {
        const matchQuery = {
            deletedAt: null,
            userId: req.user.userId
        };

        const analyticsData = await getAnalyticsService(matchQuery, { transactionModel, dbOperation });

        returnResponse("Analytics data retrieved successfully", res, 200, analyticsData);
    } catch (error) {
        next(error);
    }
}
