const express = require('express');
const { fail, isId } = require('../utils/validation');
const { collection, selection } = require('../utils/query');

// Both resources share their HTTP behavior; their write rules live in services.
module.exports = function resource(Model, service, label, defaultLimit) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        const data = await collection(Model, req.query, defaultLimit);
        res.status(200).json({ message: 'OK', data });
    });
    router.post('/', async (req, res) => {
        const data = await service.write(req.body);
        res.status(201).json({ message: label + ' created.', data });
    });
    router.get('/:id', async (req, res) => {
        if (!isId(req.params.id)) fail(404, label + ' not found.');
        const select = selection(req.query.select);
        let query = Model.findById(req.params.id);
        if (select) query = query.select(select);
        const data = await query.exec();
        if (!data) fail(404, label + ' not found.');
        res.status(200).json({ message: 'OK', data });
    });
    router.put('/:id', async (req, res) => {
        const data = await service.write(req.body, req.params.id);
        res.status(200).json({ message: label + ' updated.', data });
    });
    router.delete('/:id', async (req, res) => {
        await service.remove(req.params.id);
        res.status(204).end();
    });
    return router;
};
