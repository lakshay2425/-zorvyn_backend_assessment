import { config } from "../config/config.js"
import createHttpError from 'http-errors'
import jwt from "jsonwebtoken";
import { returnResponse } from "../utilis/returnResponse.js";

const jwtSecret = config.get("JWT_SECRET");
const environment = config.get("NODE_ENVIRONMENT");


const verifyAuthStatus = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return returnResponse("No Token is provided", res, 400);
        }

        // Verify token
        const decoded = jwt.verify(token, jwtSecret, {
            algorithms: ["HS256"]
        });

        if (!decoded || typeof decoded === "string" || !('userInfo' in decoded)) return next(createHttpError(400, "You're unauthorized to access this resource"));

        // Add user info to request object
        req.user = {
            userId: decoded.sub,
            role: decoded.userInfo.role,
        };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return next(createHttpError(401, "Token has expired, please login again"));
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return next(createHttpError(401, "Invalid token, please login again"));
        }
        console.error("Auth middleware error:", error.message);
        return next(createHttpError(500, "Internal server error"));
    }
};


export const optionalAuth = async (req, res, next) => {
    if (environment === "development" && config.get("BYPASS_AUTH") === 'true') {
        req.user = {
            role: "admin",
            userId: "69cfaf4cd681a6a77b076222"
        }
        return next();
    }
    return verifyAuthStatus(req, res, next);
}
