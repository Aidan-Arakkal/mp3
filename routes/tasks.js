module.exports = require('./resource')(
    require('../models/task'), require('../services/tasks'), 'Task', 100
);
