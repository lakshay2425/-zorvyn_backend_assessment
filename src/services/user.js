export const checkUserExistsService = async (input, dependencies) => {
    const { userId } = input;
    const { dbOperation, userModel } = dependencies;

    const user = await dbOperation(
        () => userModel.findOne({ _id: userId }).lean(),
        "Failed to find user from database"
    );

    return {
        success: true,
        exists: Boolean(user),
        user: user || null
    };
};

export const createUserProfileService = async (input, dependencies) => {
    const { userId, name } = input;
    const { dbOperation, userModel } = dependencies;

    if (!name) {
        return {
            success: false,
            status: 400,
            message: "Name is required"
        };
    }

    const existingUser = await dbOperation(
        () => userModel.findOne({ _id: userId }).lean(),
        "Failed to find user from database"
    );

    if (existingUser) {
        return {
            success: false,
            status: 409,
            message: "User profile already exists"
        };
    }

    const userPayload = {
        _id: userId,
        name,
        role: "user",
        plan: "free"
    };

    const newUser = await dbOperation(
        () => userModel.create(userPayload),
        "Failed to create user profile"
    );

    return {
        success: true,
        user: newUser
    };
};
