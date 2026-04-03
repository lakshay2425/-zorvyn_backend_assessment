
export const verifyLogin = async (inputValidation, dependenices) => {
    let userData;
    const { dbOperation, serviceOperation, userModel, bcrypt, jwt, uuidv4, secret } = dependenices;
    userData = await dbOperation(
        () => userModel.findOne({ emailLowercase: inputValidation.email.lowercase }),
        "Failed to find user from database"
    )
    const userPassword = userData?.password || uuidv4();
    const verify = await serviceOperation(
        () => bcrypt.compare(inputValidation.password, userPassword),
        "Failed to verify credentials"
    );
    if (!verify) {
        return {
            status: 401,
            success: false,
            message: "Invalid credentials, Please check your email and password and try again"
        };
    }
    const createToken = await serviceOperation(
        () => createJwtToken(userData._id, userData.role, inputValidation.email.original, {
            secret,
            jwt,
        }),
        "Failed to create JWT authentication token"
    );
    if (!createToken.success) {
        return {
            success: false,
            status: 500,
            message: createToken.message,
        }
    } else {
        return {
            success: true,
            status: 200,
            token: createToken.token,
        }
    }
}


export const signupUser = async (inputValidation, dependenices) => {
    const { dbOperation, serviceOperation, userModel,  bcrypt, jwt, secret } = dependenices;
    const email = inputValidation.email.lowercase;
    const userData = await dbOperation(
        () => userModel.findOne({ emailLowercase: email }),
        "Failed to find user from database"
    )

    if (userData) {
        const token = await serviceOperation(
            () => createJwtToken(userData._id, email, userData.role, {
                secret,
                jwt,
            }),
            "Failed to create JWT authentication token"
        );

        return {
            success: true,
            token,
        }
    }

    const hashedPassword = await serviceOperation(
        () => bcrypt.hash(inputValidation.password, 10),
        "Failed to hash the password"
    )

    const newUser = await dbOperation(
        () => userModel.create({
            password: hashedPassword,
            name: inputValidation.name,
            emailOriginal: inputValidation.email.original,
            emailLowercase: email,
            userName: inputValidation.username,
            role: inputValidation.role,
            isActive: inputValidation.isActive,
        }),
        'Failed to create user account'
    )
    const token = await serviceOperation(
        () => createJwtToken(newUser._id, inputValidation.email.original, newUser.role, {
            secret,
            jwt
        }),
        "Failed to create JWT authentication token"
    );

    return {
        success: true,
        token,
    }
}



const createJwtToken = async (id, userEmail, role, dependenices) => {
    const { secret, jwt } = dependenices;
    let payload = {
        sub: id,
        userInfo: { userEmail, role }
    }
    try {
        const token = jwt.sign(payload, secret, {
            algorithm: 'HS256',
            expiresIn: '12h',
            issuer: 'authService'
        });
        return {
            success: true,
            token
        };
    } catch (error) {
        console.error("Error in creating jwt token:", error);
        return {
            success: false,
            message: "Failed to create authentication token, Please try again later"
        };
    }
}
