const fs = require('fs')

const config = {
    owner: ["6283175676190"],
    botNumber: "6287826500927",
    setPair: "12345678",
    session: "sessions",
    prefixes: [".","#","!","/"],
    noprefix: false,
    staticQr: "",
    image: {
        thumbnail: "https://cdn.nekohime.site/file/i6iomg24.jpg",
        favicon: "https://cdn.nekohime.site/file/i6iomg24.jpg"
    },
    status: {
        public: false,
        terminal: true,
        reactsw: false,
        onlyGroup: true
    },
    message: { 
        staticQr: "QRIS belum dikonfigurasi. hubungi owner.",
        loGopay: "bot belum login GoPay. owner harus login dulu dengan .gopay",
        example: "example: ",
        admin: "khusus admin",
        group: "khusus group",
        owner: "khusus owner"
    },
    api: {
        baseurl: "https://kyuu2nd.dev/",
        apikey: null
    },
    sticker: {
        packname: "only",
        author: "kyuu2nd.dev"
    }
}

/**
 * Tulis ulang satu properti level-atas di file settings/config.js ini sendiri,
 * lalu sinkronkan config[key] agar aktif tanpa restart.
 * @param {string} key - Nama properti level atas, mis. 'prefixes' atau 'noprefix'.
 * @param {*} value - Nilai baru (harus skalar atau array).
 * @returns {boolean} true jika berhasil ditulis.
 */
function updateSetting(key, value) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        console.error(`[SETTINGS] Gagal mengedit "${key}": value berupa object tidak didukung.`);
        return false;
    }

    try {
        const filePath = __filename;
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');

        let depth = 0;
        let targetIdx = -1;
        let indent = '';

        for (let i = 0; i < lines.length; i++) {
            const bare = lines[i].replace(/(['"])(?:\\.|(?!\1).)*\1/g, '');
            depth += (bare.match(/[{[]/g) || []).length - (bare.match(/[}\]]/g) || []).length;

            const match = bare.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:/);
            if (depth === 1 && match && match[2] === key) {
                targetIdx = i;
                indent = match[1];
                break;
            }
        }

        if (targetIdx === -1) {
            console.error(`[SETTINGS] Properti "${key}" tidak ditemukan di config.js`);
            return false;
        }

        const hadComma = /,\s*$/.test(lines[targetIdx]);
        lines[targetIdx] = `${indent}${key}: ${JSON.stringify(value)}${hadComma ? ',' : ''}`;

        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        config[key] = value;
        return true;
    } catch (err) {
        console.error('[SETTINGS] Gagal mengedit file config.js:', err?.message || err);
        return false;
    }
}

config.updateSetting = updateSetting;
config.updateConfig = updateSetting;

module.exports = config;
module.exports.updateSetting = updateSetting;
module.exports.updateConfig = updateSetting;

let file = require.resolve(__filename)
require('fs').watchFile(file, () => {
  require('fs').unwatchFile(file)
  console.log('\x1b[0;32m'+__filename+' \x1b[1;32mupdated!\x1b[0m')
  delete require.cache[file]
  require(file)
})
