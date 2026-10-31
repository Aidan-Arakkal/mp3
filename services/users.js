const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { fail, isId, userInput } = require('../utils/validation');

async function existing(id, session) {
    if (!isId(id)) fail(404, 'User not found.');
    const user = await User.findById(id).session(session);
    if (!user) fail(404, 'User not found.');
    return user;
}

async function write(body, id) {
    return mongoose.connection.transaction(async session => {
        const user = id === undefined ? new User() : await existing(id, session);
        const input = userInput(body);
        const duplicate = await User.exists({ email: input.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) fail(400, 'That email is already used by another user.');

        const tasks = await Task.find({ _id: { $in: input.pendingTasks } }).session(session);
        if (tasks.length !== input.pendingTasks.length) fail(404, 'A referenced task does not exist.');
        if (tasks.some(task => task.completed)) fail(400, 'Completed tasks cannot appear in pendingTasks.');

        const userId = user._id.toString();
        const removed = user.pendingTasks.filter(taskId => !input.pendingTasks.includes(taskId));
        if (removed.length) {
            await Task.updateMany({ _id: { $in: removed }, assignedUser: userId }, {
                $set: { assignedUser: '', assignedUserName: 'unassigned' }
            }, { session });
        }
        if (input.pendingTasks.length) {
            // A task can move from another user's pending list to this user.
            await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: input.pendingTasks } }, {
                $pull: { pendingTasks: { $in: input.pendingTasks } }
            }, { session });
            await Task.updateMany({ _id: { $in: input.pendingTasks } }, {
                $set: { assignedUser: userId, assignedUserName: input.name }
            }, { session });
        }
        // Completed tasks stay assigned and must also receive a changed user name.
        await Task.updateMany({ assignedUser: userId }, {
            $set: { assignedUserName: input.name }
        }, { session });

        user.set(input);
        await user.save({ session });
        return user.toObject();
    });
}

async function remove(id) {
    return mongoose.connection.transaction(async session => {
        const user = await existing(id, session);
        await Task.updateMany({ assignedUser: user._id.toString() }, {
            $set: { assignedUser: '', assignedUserName: 'unassigned' }
        }, { session });
        await User.deleteOne({ _id: user._id }, { session });
        return user.toObject();
    });
}

module.exports = { write, remove };
