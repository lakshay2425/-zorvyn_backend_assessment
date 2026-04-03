import {asyncHandler, dbOperation} from "../utilis/advanceFunctions.js"
import {transactionModel} from "../schema/transaction.js"
import { returnResponse } from "../utilis/returnResponse.js";
import { getAnalyticsService } from "../services/analytics.js";

export const getAnalytics = asyncHandler(async (req, res, next) => {
    let matchQuery = {deletedAt: null};

    if (req.user.role === "viewer") {
        matchQuery.userId = req.user.userId; 
    }

    const analyticsData = await getAnalyticsService(matchQuery, {transactionModel, dbOperation });

    returnResponse("Analytics data retrieved successfully",res, 200, analyticsData);
})
