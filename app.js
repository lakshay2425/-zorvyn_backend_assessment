import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './src/config/config.js';
import globalErrorHandler from './src/middleware/globalErrorHandler.js';
import indexRouter from './src/routes/indexRouter.js';
import { connectToDatabase } from './src/config/mongoose.js';

const app = express();
const allowedOrigins = [config.get("AUTH_URL"), config.get("FRONTEND_URL")];
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", indexRouter);

app.get("/health", (req, res) => {
    res.status(200).json({ message: "Ok" })
})

app.use(globalErrorHandler)

export async function initializeApp() {
    await connectToDatabase();
    return app;
}

export default app;