const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replica;
let server;
let base;
let User;
let Task;
const deadline = '2026-11-03T12:00:00.000Z';
const missing = '0123456789abcdef01234567';

before(async () => {
    // Tests never connect to the project's Atlas database.
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replica.getUri('mp3-tests');
    const { app } = require('../server');
    User = require('../models/user');
    Task = require('../models/task');
    await mongoose.connect(process.env.MONGODB_URI);
    await User.init();
    await Task.init();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port + '/api';
}, { timeout: 180000 });

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (replica) await replica.stop();
});

beforeEach(async () => {
    await Task.deleteMany({});
    await User.deleteMany({});
});

async function snapshot() {
    return JSON.stringify({
        users: await User.find().sort({ _id: 1 }).lean(),
        tasks: await Task.find().sort({ _id: 1 }).lean()
    });
}

async function consistent() {
    const users = await User.find().lean();
    const tasks = await Task.find().lean();
    for (const user of users) {
        const expected = tasks.filter(t => t.assignedUser === String(user._id) && !t.completed)
            .map(t => String(t._id)).sort();
        assert.deepEqual([...user.pendingTasks].sort(), expected);
    }
    for (const task of tasks) {
        const user = users.find(u => String(u._id) === task.assignedUser);
        if (task.assignedUser) assert.ok(user, 'Assigned user must exist');
        assert.equal(task.assignedUserName, user ? user.name : 'unassigned');
    }
}

async function request(method, path, body, status = 200, raw = false) {
    const previous = await snapshot();
    const response = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) })
    });
    const json = await response.json();
    assert.equal(response.status, status, method + ' ' + path + ': ' + JSON.stringify(json));
    assert.equal(typeof json.message, 'string');
    assert.ok(Object.hasOwn(json, 'data'));
    if (status >= 400) assert.equal(await snapshot(), previous, 'Failed requests must not change data');
    await consistent();
    return json.data;
}

function user(name = 'Alice', email = name + '@example.com', extra = {}) {
    return request('POST', '/users', { name, email, ...extra }, 201);
}

function task(name = 'Homework', extra = {}) {
    return request('POST', '/tasks', { name, deadline, ...extra }, 201);
}

function query(params) {
    return '?' + new URLSearchParams(Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, JSON.stringify(value)])
    ));
}

test('home and creation return the expected envelopes and defaults', async () => {
    await request('GET', '/');
    const a = await user('Alice', 'a@example.com', { dateCreated: '2000-01-01' });
    assert.deepEqual(a.pendingTasks, []);
    assert.notEqual(a.dateCreated.slice(0, 4), '2000');
    const t = await task('Test', { dateCreated: '2000-01-01' });
    assert.equal(t.description, '');
    assert.equal(t.completed, false);
    assert.equal(t.assignedUser, '');
    assert.equal(t.assignedUserName, 'unassigned');
    assert.notEqual(t.dateCreated.slice(0, 4), '2000');
});

test('required fields, strict types, references, and duplicate email are validated', async () => {
    const a = await user();
    for (const body of [{}, { name: 'A' }, { name: 7, email: 'x' },
        { name: 'A', email: 'x', pendingTasks: 'bad' },
        { name: 'A', email: 'x', pendingTasks: ['bad'] },
        { name: 'A', email: a.email }]) {
        await request('POST', '/users', body, 400);
    }
    await request('POST', '/users', { name: 'B', email: 'b', pendingTasks: [missing] }, 404);
    for (const extra of [{ deadline: 'no-date' }, { deadline: null }, { name: 2 },
        { completed: 'false' }, { description: {} }, { assignedUser: 'bad' },
        { assignedUser: null }, { assignedUserName: 4 }, { assignedUserName: 'Alice' }]) {
        await request('POST', '/tasks', { name: 'T', deadline, ...extra }, 400);
    }
    await request('POST', '/tasks', { name: 'T' }, 400);
    await request('POST', '/tasks', { name: 'T', deadline, assignedUser: missing }, 404);
    await request('POST', '/tasks', { name: 'T', deadline, assignedUser: a._id, assignedUserName: 'Wrong' }, 400);
    await request('POST', '/users', '{broken', 400, true);
});

test('URL resource existence is checked before replacement fields', async () => {
    for (const resource of ['users', 'tasks']) {
        for (const id of ['bad', missing]) {
            await request('GET', '/' + resource + '/' + id, undefined, 404);
            await request('PUT', '/' + resource + '/' + id, {}, 404);
            await request('DELETE', '/' + resource + '/' + id, undefined, 404);
        }
        assert.deepEqual(await request('GET', '/' + resource + query({ where: { _id: missing } })), []);
    }
});

test('task assignment, reassignment, completion, reopening, and replacement defaults', async () => {
    const a = await user();
    const b = await user('Bob');
    const t = await task('Assigned', { assignedUser: a._id, description: 'old' });
    assert.equal(t.assignedUserName, a.name);
    let updated = await request('PUT', '/tasks/' + t._id, {
        name: 'Moved', deadline, assignedUser: b._id, completed: true
    });
    assert.equal(updated.dateCreated, t.dateCreated);
    assert.equal(updated.description, '');
    updated = await request('PUT', '/tasks/' + t._id, {
        name: 'Completed transfer', deadline, assignedUser: a._id, completed: true
    });
    assert.equal(updated.assignedUser, a._id);
    await request('PUT', '/tasks/' + t._id, { name: 'Reopen', deadline, assignedUser: a._id });
    updated = await request('PUT', '/tasks/' + t._id, { name: 'Reset', deadline });
    assert.equal(updated.assignedUser, '');
    assert.equal(updated.assignedUserName, 'unassigned');
});

test('user updates move tasks, unassign removals, and rename completed assignments', async () => {
    const a = await user();
    const b = await user('Bob');
    const pending = await task('Pending', { assignedUser: a._id });
    const completed = await task('Completed', { assignedUser: a._id, completed: true });
    const renamed = await request('PUT', '/users/' + a._id, {
        name: 'Alicia', email: a.email, pendingTasks: [pending._id], dateCreated: '2000-01-01'
    });
    assert.equal(renamed.dateCreated, a.dateCreated);
    assert.equal((await request('GET', '/tasks/' + completed._id)).assignedUserName, 'Alicia');
    await request('PUT', '/users/' + b._id, {
        name: b.name, email: b.email, pendingTasks: [pending._id]
    });
    await request('PUT', '/users/' + b._id, { name: b.name, email: b.email });
    assert.equal((await request('GET', '/tasks/' + pending._id)).assignedUser, '');
    await request('PUT', '/users/' + a._id, {
        name: a.name, email: a.email, pendingTasks: [completed._id]
    }, 400);
});

test('creating a user with pending tasks transfers existing assignments', async () => {
    const a = await user();
    const t = await task('Transfer', { assignedUser: a._id });
    const b = await user('Bob', 'b@example.com', { pendingTasks: [t._id, t._id] });
    assert.deepEqual(b.pendingTasks, [t._id]);
    assert.equal((await request('GET', '/tasks/' + t._id)).assignedUser, b._id);
});

test('invalid updates are atomic and preserve existing assignments', async () => {
    const a = await user();
    const b = await user('Bob');
    const t = await task('Keep', { assignedUser: a._id });
    await request('PUT', '/users/' + a._id, { name: 'Changed', email: b.email }, 400);
    await request('PUT', '/users/' + a._id, {
        name: 'Changed', email: a.email, pendingTasks: [t._id, missing]
    }, 404);
    await request('PUT', '/tasks/' + t._id, {
        name: 'Changed', deadline, assignedUser: b._id, assignedUserName: 'Wrong'
    }, 400);
});

test('transaction rolls back writes when a later database operation fails', async () => {
    const a = await user();
    const t = await task('Rollback');
    const original = User.updateOne;
    User.updateOne = function () { throw new Error('Simulated write failure'); };
    try {
        await request('PUT', '/tasks/' + t._id, { name: 'Changed', deadline, assignedUser: a._id }, 500);
    } finally {
        User.updateOne = original;
    }
});

test('delete cleans pending and completed references', async () => {
    const a = await user();
    const pending = await task('Pending', { assignedUser: a._id });
    const completed = await task('Completed', { assignedUser: a._id, completed: true });
    await request('DELETE', '/tasks/' + pending._id);
    await request('GET', '/tasks/' + pending._id, undefined, 404);
    const other = await task('Other', { assignedUser: a._id });
    await request('DELETE', '/users/' + a._id);
    await request('GET', '/users/' + a._id, undefined, 404);
    assert.equal((await request('GET', '/tasks/' + completed._id)).assignedUser, '');
    assert.equal((await request('GET', '/tasks/' + other._id)).assignedUserName, 'unassigned');
});

test('concurrent completed-task creation and user rename keep names synchronized', async () => {
    const a = await user();
    for (let i = 0; i < 5; i++) {
        const responses = await Promise.all([
            fetch(base + '/users/' + a._id, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Renamed ' + i, email: a.email })
            }),
            fetch(base + '/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Completed ' + i, deadline, completed: true, assignedUser: a._id })
            })
        ]);
        assert.deepEqual(responses.map(response => response.status), [200, 201]);
        await consistent();
    }
});

test('concurrent user deletion and completed-task creation leave no dangling reference', async () => {
    for (let i = 0; i < 5; i++) {
        const a = await user('User ' + i);
        const responses = await Promise.all([
            fetch(base + '/users/' + a._id, { method: 'DELETE' }),
            fetch(base + '/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Concurrent ' + i, deadline, completed: true, assignedUser: a._id })
            })
        ]);
        assert.equal(responses[0].status, 200);
        assert.ok([201, 404].includes(responses[1].status));
        await consistent();
    }
});

test('collection queries compose filtering, sorting, projection, pagination and count', async () => {
    const a = await user();
    await user('Bob');
    await task('A', { completed: true });
    await task('B');
    await task('C');
    const data = await request('GET', '/tasks' + query({
        where: { completed: false }, sort: { name: -1 }, skip: 1, limit: 1,
        select: { name: 1, _id: 0 }
    }));
    assert.deepEqual(data, [{ name: 'B' }]);
    assert.equal(await request('GET', '/tasks' + query({ where: { completed: false }, count: true })), 2);
    assert.equal(await request('GET', '/users' + query({ where: { _id: missing }, count: true })), 0);
    assert.deepEqual(await request('GET', '/users' + query({ where: { _id: { $in: [a._id] } }, select: { name: 1, _id: 0 } })), [{ name: 'Alice' }]);
    assert.deepEqual(await request('GET', '/users/' + a._id + query({ select: { name: 1, _id: 0 } }) + '&where=broken&count=broken'), { name: 'Alice' });
    const t = (await request('GET', '/tasks'))[0];
    assert.deepEqual(await request('GET', '/tasks/' + t._id + query({ select: { name: 1, _id: 0 } })), { name: t.name });
});

test('task default limit is 100, user default is unlimited, and limit 0 is unlimited', async () => {
    await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: 'Task ' + i, deadline })));
    await User.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: 'User ' + i, email: i + '@example.com' })));
    assert.equal((await request('GET', '/tasks')).length, 100);
    assert.equal((await request('GET', '/users')).length, 105);
    assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
});

test('malformed query values return readable 400 errors', async () => {
    for (const param of ['where', 'sort', 'select', 'skip', 'limit', 'count']) {
        await request('GET', '/tasks?' + param + '=broken', undefined, 400);
    }
    for (const params of [{ where: [] }, { sort: { name: 5 } }, { select: { name: 7 } },
        { select: { name: 1, description: 0 } }, { limit: -1 }, { skip: 1.5 },
        { count: 'true' }, { where: { $notAnOperator: true } }]) {
        await request('GET', '/tasks' + query(params), undefined, 400);
    }
    const a = await user();
    await request('GET', '/users/' + a._id + '?select=broken', undefined, 400);
    await request('GET', '/unknown', undefined, 404);
});
