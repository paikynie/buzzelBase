const fs = require('fs');
const path = require('path');

const KIRANN_FILE = path.join(__dirname, '../../library/database/kirann.json');

if (!fs.existsSync(KIRANN_FILE)) {
    fs.writeFileSync(KIRANN_FILE, JSON.stringify({}, null, 2));
}

function getKirannStatus(chatId) {
    const data = JSON.parse(fs.readFileSync(KIRANN_FILE, 'utf-8'));
    return data[chatId] || false;
}

function setKirannStatus(chatId, status) {
    const data = JSON.parse(fs.readFileSync(KIRANN_FILE, 'utf-8'));
    data[chatId] = status;
    fs.writeFileSync(KIRANN_FILE, JSON.stringify(data, null, 2));
    return true;
}

function deleteKirannStatus(chatId) {
    const data = JSON.parse(fs.readFileSync(KIRANN_FILE, 'utf-8'));
    delete data[chatId];
    fs.writeFileSync(KIRANN_FILE, JSON.stringify(data, null, 2));
    return true;
}

module.exports = {
    getKirannStatus,
    setKirannStatus,
    deleteKirannStatus
};