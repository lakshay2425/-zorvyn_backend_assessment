import createHttpError from "http-errors";
import { signupUser, verifyLogin } from "../services/user.js";
import {userModel} from "../schema/user.js";
import bcrypt from "bcrypt";
import { config } from "../config/config.js"
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, dbOperation, serviceOperation } from "../utilis/advanceFunctions.js";
import { loginSchema, signupSchema } from "../validationSchemas/user.js";
import { ERROR_MESSAGES } from "../validationSchemas/error.js";


export const userLogin = asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;
    const inputValidation = loginSchema.safeParse({ email, password });
    if (!inputValidation.success) {
        return next(createHttpError(400, ERROR_MESSAGES.LOGIN.INVALID_INPUT));
    }
    const secret = config.get("JWT_SECRET");
    const loginInfo = await verifyLogin(inputValidation.data, { bcrypt, userModel, jwt, dbOperation, serviceOperation, uuidv4, secret });
    if (!loginInfo.success) {
        return next(createHttpError(loginInfo.status, loginInfo.message));
    } else {
        res.cookie('token', loginInfo.token, cookieOption);
        res.status(200).json({
            message: "User logged in successfully",
        })
    }
})


export const userSignup = asyncHandler(async (req, res, next) => {
    const { name, email, password, username, isActive, role } = req.body;

    //Validation
    const inputValidation = signupSchema.safeParse({ name, email, password, username, isActive, role });
    if (!inputValidation.success) {
        return next(createHttpError(400, ERROR_MESSAGES.SIGNUP.INVALID_INPUT));
    }
    const secret = config.get("JWT_SECRET");
    const signupInfo = await signupUser(inputValidation.data, { dbOperation, serviceOperation, bcrypt, userModel, jwt, secret })
    if(signupInfo.success === false) {
        return next(createHttpError(signupInfo.status, signupInfo.message));
    }else{
        res.cookie('token', signupInfo.token, cookieOption);
        res.status(200).json({
            message: "User signed up successfully",
        })
    }
})

export const userLogout = async (req, res) => {
    const environment = config.get("NODE_ENVIRONMENT");
    res.clearCookie('token', {
        httpOnly: true,
        secure: environment === "production",
        sameSite: environment === "production" ? "lax" : "none",
        path: '/',
        domain: environment === "production" ? `.${config.get("DOMAIN")}` : undefined,
    });

    return res.status(200).json({
        message: "User logged out successfully",
    })
}

const environment = config.get("NODE_ENVIRONMENT");
const cookieOption = {
    httpOnly: true,
    secure: environment === "production",
    sameSite: environment === "production" ? "lax" : "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
    domain: environment === "production" ? `.${config.get("DOMAIN")}` : undefined,
}
