import { config } from "../config/config.js"
import createHttpError from 'http-errors'
import jwt from "jsonwebtoken";
import { returnResponse } from "../utilis/returnResponse.js";

const environment = config.get("NODE_ENVIRONMENT");

let cachedPublicKey = null;

/**
 * Placeholder — replace with the auth service JWKS / public-key endpoint.
 * Fetches once and caches the RSA public key in memory for subsequent verifications.
 */
const fetchPublicKey = async () => {
    if (cachedPublicKey) {
        return cachedPublicKey;
    }

    // TODO: replace with real auth-service public key fetch
    // const response = await fetch(process.env.AUTH_PUBLIC_KEY_URL);
    // const data = await response.json();
    // cachedPublicKey = data.publicKey;
    // return cachedPublicKey;

    throw createHttpError(500, "Auth public key fetch is not configured");
};

const verifyAuthStatus = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return returnResponse("No Token is provided", res, 400);
        }

        const publicKey = await fetchPublicKey();

        const decoded = jwt.verify(token, publicKey, {
            algorithms: ["RS256"]
        });

        if (!decoded || typeof decoded === "string" || !decoded.sub) {
            return next(createHttpError(401, "You're unauthorized to access this resource"));
        }

        req.user = {
            userId: decoded.sub,
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
