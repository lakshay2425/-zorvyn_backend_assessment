import pkg from "mongoose"
const { Schema, model, models } = pkg

const userSchema = new Schema({
    _id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    role: {
        type: String,
        default: "user"
    },
    plan: {
        type: String,
        default: "free"
    }
}, { timestamps: true })

export const userModel = models.User || model("User", userSchema);
