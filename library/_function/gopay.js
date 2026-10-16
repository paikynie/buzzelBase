const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../library/database/gopay.json');

function loadData() {
    try {
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, JSON.stringify({}, null, 2));
        }
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getSession(userId) {
    const data = loadData();
    return data[userId] || null;
}

function setSession(userId, session) {
    const data = loadData();
    data[userId] = session;
    saveData(data);
}

function deleteSession(userId) {
    const data = loadData();
    delete data[userId];
    saveData(data);
}

function getSessionsAll() {
    return loadData();
}

module.exports = { 
    getSession,
    setSession,
    deleteSession, 
    getSessionsAll
};