import express from 'express';
import globalErrorHandler from './src/middleware/globalErrorHandler.js';
import indexRouter from './src/routes/indexRouter.js';
import { connectToDatabase } from './src/config/mongoose.js';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
connectToDatabase();
app.use("/api", indexRouter);

app.get("/health", (req, res) => {
    res.status(200).json({ message: "Ok" })
})

app.use(globalErrorHandler)

export default app;
