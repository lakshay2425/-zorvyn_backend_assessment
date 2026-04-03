const _config = {
    PORT: process.env.PORT,
    NODE_ENVIRONMENT: process.env.NODE_ENV,
    dbURI: process.env.DB_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    BYPASS_AUTH: process.env.BYPASS_AUTH,
    TEST_USER_EMAIL: process.env.TEST_USER_EMAIL,
    DOMAIN: process.env.DOMAIN
}


export const config = {
    get(key) { 
        const value = _config[key];
        if (value === undefined || value === null || value === "") {
            console.error(`Config key "${key}" not found.`);
            process.exit(1);
        }
        return value;
    }
}
