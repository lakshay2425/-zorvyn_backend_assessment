const _config = {
    PORT: process.env.PORT,
    NODE_ENVIRONMENT: process.env.NODE_ENV || 'development',
    dbURI: process.env.DB_URI || 'mongodb://localhost:27017/base',
    JWT_SECRET: process.env.JWT_SECRET || "your-default-secret-key",
    BYPASS_AUTH: process.env.BYPASS_AUTH || "false",
    TEST_USER_EMAIL: process.env.TEST_USER_EMAIL || "your-test-email"
}


export const config = {
    get(key) { 
        const value = _config[key];
        if (value === undefined || value === null) {
            console.error(`Config key "${key}" not found.`);
            process.exit(1);
        }
        return value;
    }
}
