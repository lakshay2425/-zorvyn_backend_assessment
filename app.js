import express from 'express';
import globalErrorHandler from './src/middleware/globalErrorHandler.js';
const app = express();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req,res)=>{
    res.status(200).json({message:"Ok"})
})


app.use(globalErrorHandler)

export default app;
