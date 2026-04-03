import pkg from "mongoose"
const { Schema, model, models } = pkg


const transactionSchema = new Schema({
    amount: {
        type: Number,
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ["income", "expense"]
    },
    date: {
        type: Date,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true })

export const transactionModel = models.Transaction || model("Transaction", transactionSchema);
