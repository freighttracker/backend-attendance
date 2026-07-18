const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replset;

// A single-node replica set (not a plain MongoMemoryServer) - payroll slip
// generation uses mongoose sessions/transactions (runGenerateForUser), which
// MongoDB only allows on a replica set or mongos, same as the real Atlas
// cluster this app deploys against.
const connect = async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replset.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);
};

const closeDatabase = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (replset) await replset.stop();
};

const clearDatabase = async () => {
    const { collections } = mongoose.connection;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
};

module.exports = { connect, closeDatabase, clearDatabase };
