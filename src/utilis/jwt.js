import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const JWKS_URI = "https://authentication.lakshaymahajan.com/.well-known/jwks.json";

export const JWT_ISSUER = "auth-service";
export const JWT_ALGORITHM = "RS256";

const client = jwksClient({
    jwksUri: JWKS_URI,
    cache: true,
    rateLimit: true,
});

function getKey(header, callback) {
    if (!header.kid) {
        callback(new Error("JWT header missing kid"));
        return;
    }

    client.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
            callback(err ?? new Error("Signing key not found"));
            return;
        }
        callback(null, key.getPublicKey());
    });
}

export function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(
            token,
            getKey,
            { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER },
            (err, decoded) => {
                if (err) return reject(err);
                resolve(decoded);
            },
        );
    });
}
