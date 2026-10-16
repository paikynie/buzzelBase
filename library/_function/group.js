const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../library/database/group.json');

if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}, null, 2));
}

function loadData() {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getGroupSetting(groupId, setting, defaultValue = false) {
    const data = loadData();
    if (!data[groupId]) return defaultValue;
    return data[groupId][setting] !== undefined ? data[groupId][setting] : defaultValue;
}

function setGroupSetting(groupId, setting, value) {
    const data = loadData();
    if (!data[groupId]) data[groupId] = {};
    data[groupId][setting] = value;
    saveData(data);
}

module.exports = {
    getGroupSetting,
    setGroupSetting
};