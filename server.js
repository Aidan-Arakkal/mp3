const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('./routes')(app);
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint not found.', data: null });
});
app.use(require('./middleware/errors'));

async function startServer() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing. Check your .env file.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.db.admin().ping();
    // Ensure unique email enforcement is ready before requests arrive.
    await require('./models/user').init();
    await require('./models/task').init();
    console.log('Connected to MongoDB');
    const server = app.listen(port, () => console.log('Server running on port ' + server.address().port));
    server.on('error', async error => {
        console.error('HTTP server failed:', error.code);
        await mongoose.disconnect();
        process.exitCode = 1;
    });
    return server;
}

if (require.main === module) {
    startServer().catch(async error => {
        console.error('Startup failed:', error.name, '- check database configuration and network access.');
        await mongoose.disconnect();
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
