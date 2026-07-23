import createHttpError from "http-errors";
import { checkUserExistsService, createUserProfileService } from "../services/user.js";
import { userModel } from "../schema/user.js";
import { dbOperation } from "../utilis/advanceFunctions.js";
import { createUserProfileSchema } from "../validationSchemas/user.js";
import { returnResponse } from "../utilis/returnResponse.js";

export const checkUserExists = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const result = await checkUserExistsService(
            { userId },
            { dbOperation, userModel }
        );

        return returnResponse("User existence checked successfully", res, 200, {
            exists: result.exists,
            user: result.user
        });
    } catch (error) {
        next(error);
    }
};

export const createUserProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const inputValidation = createUserProfileSchema.safeParse(req.body ?? {});

        if (!inputValidation.success) {
            return next(createHttpError(400, "Invalid data"));
        }

        const result = await createUserProfileService(
            {
                userId,
                name: inputValidation.data.name
            },
            { dbOperation, userModel }
        );

        if (!result.success) {
            return next(createHttpError(result.status, result.message));
        }

        return returnResponse("User profile created successfully", res, 201, {
            user: result.user
        });
    } catch (error) {
        next(error);
    }
};
