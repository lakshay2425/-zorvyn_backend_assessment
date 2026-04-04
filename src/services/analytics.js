export const getAnalyticsService = async (matchQuery, dependencies) => {
    const { transactionModel, dbOperation } = dependencies;
    const results = await dbOperation(() => {
        return transactionModel.aggregate([
            { $match: matchQuery },
            {
                $facet: {
                    "totals": [
                        {
                            $group: {
                                _id: null,
                                totalIncome: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
                                totalExpense: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
                                count: { $sum: 1 }
                            }
                        },
                        { $project: { _id: 0 } } // Clean up the null ID
                    ],
                    "categoryBreakdown": [
                        {
                            $group: {
                                _id: "$category",
                                netBalance: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$type", "income"] },
                                            "$amount",
                                            { $multiply: ["$amount", -1] } // Treat expense as negative
                                        ]
                                    }
                                }
                            }
                        },
                        { $sort: { total: -1 } }
                    ]
                }
            }
        ]);
    }, "Failed to fetch analytics data");

    const data = results[0];
    return {
        totals: data.totals[0] || { totalIncome: 0, totalExpense: 0, count: 0 },
        categoryBreakdown: data.categoryBreakdown
    };
};
