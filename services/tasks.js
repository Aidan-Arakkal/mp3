const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { fail, isId, taskInput } = require('../utils/validation');

async function existing(id, session) {
    if (!isId(id)) fail(404, 'Task not found.');
    const task = await Task.findById(id).session(session);
    if (!task) fail(404, 'Task not found.');
    return task;
}

async function write(body, id) {
    return mongoose.connection.transaction(async session => {
        const task = id === undefined ? new Task() : await existing(id, session);
        const input = taskInput(body);
        if (input.assignedUser) {
            const user = await User.findById(input.assignedUser).session(session);
            if (!user) fail(404, 'The assigned user does not exist.');
            if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) {
                fail(400, 'assignedUserName must match the assigned user\'s name.');
            }
            input.assignedUserName = user.name;
        } else {
            input.assignedUserName = 'unassigned';
        }

        const taskId = task._id.toString();
        if (task.assignedUser) {
            await User.updateOne({ _id: task.assignedUser }, {
                $pull: { pendingTasks: taskId },
                $inc: { __v: 1 }
            }, { session });
        }
        task.set(input);
        await task.save({ session });
        if (input.assignedUser) {
            // Touch the parent even for completed tasks. This makes a concurrent
            // user rename/delete conflict and retry instead of leaving a stale reference.
            await User.updateOne({ _id: input.assignedUser }, {
                ...(input.completed
                    ? { $pull: { pendingTasks: taskId } }
                    : { $addToSet: { pendingTasks: taskId } }),
                $inc: { __v: 1 }
            }, { session });
        }
        return task.toObject();
    });
}

async function remove(id) {
    return mongoose.connection.transaction(async session => {
        const task = await existing(id, session);
        if (task.assignedUser) {
            await User.updateOne({ _id: task.assignedUser }, {
                $pull: { pendingTasks: task._id.toString() },
                $inc: { __v: 1 }
            }, { session });
        }
        await Task.deleteOne({ _id: task._id }, { session });
        return task.toObject();
    });
}

module.exports = { write, remove };
