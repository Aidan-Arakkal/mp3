module.exports = function (err, req, res, next) {
    if (res.headersSent) return next(err);
    let status = 500;
    let message = 'An unexpected server error occurred.';
    if (err.status && err.status >= 400 && err.status < 500) {
        status = err.status;
        message = err.message;
    }
    if (err.type === 'entity.parse.failed') {
        status = 400;
        message = 'The request body contains invalid JSON.';
    } else if (err.code === 11000) {
        status = 400;
        message = 'That email is already used by another user.';
    } else if (['ValidationError', 'CastError', 'StrictModeError'].includes(err.name)) {
        status = 400;
        message = 'A field or query value is invalid. Check the supplied values.';
    } else if (err.name === 'MongoServerError' && [2, 9, 14, 72, 168, 31254].includes(err.code)) {
        status = 400;
        message = 'The supplied query is invalid.';
    }
    if (status === 500) console.error('Request failed:', err.name);
    res.status(status).json({ message, data: null });
};
