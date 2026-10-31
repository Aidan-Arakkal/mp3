const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    pendingTasks: { type: [String], default: [] }
}, { timestamps: { createdAt: 'dateCreated', updatedAt: false } });

module.exports = mongoose.model('User', schema);
