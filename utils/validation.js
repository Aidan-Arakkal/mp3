function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function isId(value) {
    return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function canonicalId(value) {
    return value.toLowerCase();
}

function bodyObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        fail(400, 'The request body must be a JSON object.');
    }
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        fail(400, field + ' must be a nonempty string.');
    }
}

function userInput(body) {
    bodyObject(body);
    requiredString(body.name, 'name');
    requiredString(body.email, 'email');
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || pendingTasks.some(id => !isId(id))) {
        fail(400, 'pendingTasks must be an array of valid task ID strings.');
    }
    return {
        name: body.name,
        email: body.email,
        pendingTasks: [...new Set(pendingTasks.map(canonicalId))]
    };
}

function taskInput(body) {
    bodyObject(body);
    requiredString(body.name, 'name');
    if (typeof body.deadline !== 'string' || !body.deadline.trim() ||
        !Number.isFinite(new Date(body.deadline).getTime())) {
        fail(400, 'deadline must be a valid date string.');
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
        fail(400, 'description must be a string.');
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
        fail(400, 'completed must be a boolean.');
    }
    const assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (assignedUser !== '' && !isId(assignedUser)) {
        fail(400, 'assignedUser must be a valid user ID or an empty string.');
    }
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
        fail(400, 'assignedUserName must be a string.');
    }
    if (assignedUser === '' && body.assignedUserName !== undefined &&
        body.assignedUserName !== 'unassigned') {
        fail(400, 'An unassigned task must have assignedUserName "unassigned".');
    }
    return {
        name: body.name,
        description: body.description === undefined ? '' : body.description,
        deadline: new Date(body.deadline),
        completed: body.completed === undefined ? false : body.completed,
        assignedUser: assignedUser ? canonicalId(assignedUser) : '',
        assignedUserName: body.assignedUserName
    };
}

module.exports = { fail, isId, userInput, taskInput };
