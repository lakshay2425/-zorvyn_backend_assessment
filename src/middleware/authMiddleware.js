import { config } from "../config/config.js"
import createHttpError from 'http-errors'
import jwt from "jsonwebtoken";
import { returnResponse } from "../utilis/returnResponse.js";
import { verifyToken } from "../utilis/jwt.js";

const environment = config.get("NODE_ENVIRONMENT");

const verifyAuthStatus = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return returnResponse("No Token is provided", res, 400);
        }

        const decoded = await verifyToken(token);

        if (!decoded || typeof decoded === "string" || !decoded.sub) {
            return next(createHttpError(401, "You're unauthorized to access this resource"));
        }

        req.user = {
            userId: decoded.sub,
            email: decoded.userInfo?.userEmail,
        };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return next(createHttpError(401, "Token has expired, please login again"));
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return next(createHttpError(401, "Invalid token, please login again"));
        }
        if (error.statusCode) {
            return next(error);
        }
        console.error("Auth middleware error:", error.message);
        return next(createHttpError(500, "Internal server error"));
    }
};


export const optionalAuth = async (req, res, next) => {
    if (environment === "development" && config.get("BYPASS_AUTH") === 'true') {
        req.user = {
            userId: "69cfaf4cd681a6a77b076222"
        }
        return next();
    }
    return verifyAuthStatus(req, res, next);
}
