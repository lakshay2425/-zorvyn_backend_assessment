import pkg from "mongoose"
const { Schema, model, models } = pkg

const userSchema = new Schema({
    userName: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ["viewer", "analyst", "admin"]
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true })

export const userModel = models.User || model("User", userSchema);
