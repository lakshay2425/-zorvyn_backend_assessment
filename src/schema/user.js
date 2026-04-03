import pkg from "mongoose"
const { Schema, model, models } = pkg

const userSchema = new Schema({
    userName: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
        emailOriginal: {
        type: String,
        required: true,
    },
    emailLowercase: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ["viewer", "analyst", "admin"],
        default: "viewer"
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true })

export const userModel = models.User || model("User", userSchema);
