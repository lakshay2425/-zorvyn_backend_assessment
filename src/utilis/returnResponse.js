//Function to return success response
export const returnResponse = (message,  res, statusCode, additionalFields={}, headers={})=>{
    Object.keys(headers).forEach(key => res.setHeader(key, headers[key]));

    return res.status(statusCode).json({
        success: true,
        message: message,
        ...additionalFields
    })
}
