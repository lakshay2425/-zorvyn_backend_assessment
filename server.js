import { config } from "./src/config/config.js";
import { initializeApp } from "./app.js";
import { balanceCache } from "./src/controllers/transactions.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const startBalanceCacheEviction = () => {
    setInterval(() => {
        const now = Date.now();
        for (const [userId, entry] of Object.entries(balanceCache)) {
            if (!entry?.lastUpdatedAt || now - entry.lastUpdatedAt > TWENTY_FOUR_HOURS_MS) {
                delete balanceCache[userId];
            }
        }
    }, ONE_HOUR_MS);
};

const startServer = async () => {
    try {
        const app = await initializeApp();
        const PORT = config.get("PORT");
        startBalanceCacheEviction();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error.message);
        process.exit(1);
    }
};

startServer();
