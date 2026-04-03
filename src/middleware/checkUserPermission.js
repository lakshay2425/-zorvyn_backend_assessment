import createHttpError from "http-errors";
import { ROLE_PERMISSIONS } from "../constants/permissions.js";

export const checkUserPermission = (requiredPermission) => {
    return (req, res, next) => {
        try {
            const userRole = req.user?.role;

            if (!userRole) {
                return next(createHttpError(401, "User role not found. Authentication required."));
            }

            const permissions = ROLE_PERMISSIONS[userRole] || [];

            if (!permissions.includes(requiredPermission)) {
                return next(createHttpError(403, "Access Denied: You do not have permission to perform this action."));
            }

            next();
        } catch (error) {
            next(createHttpError(500, "Internal Server Error during permission check."));
        }
    };
};
