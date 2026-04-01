import { config } from '../config/config.js';

const globalErrorHandler = (err, _req, res, _next) => { 
  const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        errStack: config.get("NODE_ENVIRONMENT") === 'development' ? err.stack : "",
        message: err.message || 'Internal Server Error'
    });
}


export default globalErrorHandler;
