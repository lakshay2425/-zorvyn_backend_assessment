//Function to return success response
export const returnResponse = (message,  res, statusCode, additionalFields={})=>{
    return res.status(statusCode).json({
        success: true,
        message: message,
        ...additionalFields
    })
}
