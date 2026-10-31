const { fail } = require('./validation');

function parse(raw, field) {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') fail(400, field + ' must be a single JSON value.');
    try {
        return JSON.parse(raw);
    } catch {
        fail(400, field + ' contains invalid JSON.');
    }
}

function objectOption(raw, field) {
    const value = parse(raw, field);
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
        fail(400, field + ' must be a JSON object.');
    }
    return value;
}

function selection(raw) {
    const select = objectOption(raw, 'select');
    if (select) {
        if (Object.values(select).some(value => value !== 0 && value !== 1)) {
            fail(400, 'select values must be 0 or 1.');
        }
        const modes = new Set(Object.entries(select).filter(([key]) => key !== '_id').map(([, value]) => value));
        if (modes.size > 1) fail(400, 'select cannot mix field inclusion and exclusion, except for _id.');
    }
    return select;
}

function integerOption(raw, field, fallback) {
    const value = parse(raw, field);
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(400, field + ' must be a nonnegative integer.');
    }
    return value;
}

async function collection(Model, params, defaultLimit) {
    const where = objectOption(params.where, 'where') || {};
    const sort = objectOption(params.sort, 'sort');
    if (sort && Object.values(sort).some(value => value !== 1 && value !== -1)) {
        fail(400, 'sort values must be 1 or -1.');
    }
    const select = selection(params.select);
    const skip = integerOption(params.skip, 'skip', 0);
    const limit = integerOption(params.limit, 'limit', defaultLimit);
    const count = parse(params.count, 'count');
    if (count !== undefined && typeof count !== 'boolean') fail(400, 'count must be a boolean.');
    if (count === true) return Model.countDocuments(where).exec();
    let query = Model.find(where).skip(skip).limit(limit);
    if (sort) query = query.sort(sort);
    if (select) query = query.select(select);
    return query.exec();
}

module.exports = { collection, selection };
