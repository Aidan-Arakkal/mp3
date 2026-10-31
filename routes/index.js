module.exports = function (app) {
    app.use('/api', require('./home'));
    app.use('/api/users', require('./users'));
    app.use('/api/tasks', require('./tasks'));
};
