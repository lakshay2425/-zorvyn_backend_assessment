const _config = {
    PORT: process.env.PORT,
    NODE_ENVIRONMENT: process.env.NODE_ENV,
    dbURI: process.env.DB_URI,
    BYPASS_AUTH: process.env.BYPASS_AUTH,
    AUTH_URL: process.env.AUTH_URL,
    FRONTEND_URL: process.env.FRONTEND_URL
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
