/**
 * @fileoverview Plugin to retrieve recent messages stored in the database as a .js file export.
 */

module.exports = {
    name: 'getmsg',
    command: ['getmsg', 'getpesan', 'listmsg'],
    tags: ['tools', 'group'],
    help: ['getmsg <jumlah> [target] [--all]'],

    /**
     * Executes the getmsg command and returns message history as a .js document.
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { text, reply, store }) {
        if (!store || !store.db) {
            return reply('⚠️ Store database belum aktif.');
        }

        let targetJid = m.chat;
        let count = 5;
        let includeProtocol = false;

        const rawArgs = text.trim().split(/\s+/).filter(Boolean);
        for (const arg of rawArgs) {
            if (arg === '--all' || arg === '--raw' || arg === '--proto') {
                includeProtocol = true;
            } else if (arg.endsWith('@g.us') || arg.endsWith('@s.whatsapp.net') || arg.endsWith('@lid')) {
                targetJid = arg;
            } else if (/^\d{17,20}$/.test(arg)) {
                targetJid = `${arg}@g.us`;
            } else if (/^\d{9,16}$/.test(arg)) {
                targetJid = `${arg}@s.whatsapp.net`;
            } else if (!isNaN(parseInt(arg, 10))) {
                count = parseInt(arg, 10);
            }
        }

        count = Math.max(1, Math.min(100, count));
        const isGroupTarget = targetJid.endsWith('@g.us');

        const protoCondition = includeProtocol ? '' : "AND messageType != 'protocolMessage'";
        const excludeBotDocs = "AND NOT (fromMe = 1 AND messageType = 'documentMessage')";
        const excludeCmds = "AND NOT (body LIKE '.getmsg%' OR body LIKE ',getmsg%')";

        const sql = isGroupTarget
            ? `SELECT rowid, id, remoteJid, sender, pushName, messageTimestamp, createdAt, raw, isDeleted 
               FROM messages 
               WHERE remoteJid = ? ${protoCondition} ${excludeBotDocs} ${excludeCmds}
               ORDER BY rowid DESC LIMIT ?`
            : `SELECT rowid, id, remoteJid, sender, pushName, messageTimestamp, createdAt, raw, isDeleted 
               FROM messages 
               WHERE (remoteJid = ? OR sender = ?) ${protoCondition} ${excludeBotDocs} ${excludeCmds}
               ORDER BY rowid DESC LIMIT ?`;

        const queryParams = isGroupTarget ? [targetJid, count + 10] : [targetJid, targetJid, count + 10];

        let rows = [];
        try {
            rows = store.db.prepare(sql).all(...queryParams);
        } catch (err) {
            return reply(`⚠️ Gagal mengambil pesan: ${err.message}`);
        }

        const filtered = rows.filter(r => r.id !== m.key.id).slice(0, count);

        const displayTarget = targetJid.replace(/@s\.whatsapp\.net$/, '');
        if (!filtered.length) {
            return reply(`Belum ada pesan yang tersimpan untuk target:\n• Target : ${displayTarget}`);
        }

        filtered.reverse();

        const items = filtered.map((r, idx) => {
            let rawObj = {};
            try {
                rawObj = JSON.parse(r.raw);
            } catch {}

            const key = rawObj.key || { remoteJid: r.remoteJid, fromMe: Boolean(r.fromMe), id: r.id };
            let sender = r.sender;
            let senderLid = null;

            const p1 = key.participant || '';
            const p2 = key.participantAlt || '';

            if (p1.endsWith('@s.whatsapp.net')) sender = p1;
            else if (p2.endsWith('@s.whatsapp.net')) sender = p2;

            if (p1.endsWith('@lid')) senderLid = p1;
            else if (p2.endsWith('@lid')) senderLid = p2;
            else if (rawObj.senderLid) senderLid = rawObj.senderLid;
            else if (typeof r.sender === 'string' && r.sender.endsWith('@lid')) senderLid = r.sender;

            if (!sender || sender === 'me') {
                sender = key.remoteJid || r.remoteJid;
            }

            const item = {
                rowid: Number(r.rowid),
                index: idx + 1,
                chat: r.remoteJid,
                id: r.id,
                sender,
                pushName: r.pushName || rawObj.pushName || '',
                timestamp: Number(r.messageTimestamp || Math.floor(r.createdAt / 1000)),
                key: {
                    remoteJid: key.remoteJid,
                    fromMe: Boolean(key.fromMe),
                    id: key.id,
                    ...(r.remoteJid.endsWith('@g.us') ? { participant: sender || key.participant } : {})
                },
                message: rawObj.message || {},
                additionalNodes: rawObj.additionalNodes || []
            };

            if (senderLid) {
                item.senderLid = senderLid;
            }

            if (r.isDeleted) {
                item.isDeleted = true;
            }

            return item;
        });

        const fileCode = Math.floor(100000 + Math.random() * 900000);
        const fileName = `store-${fileCode}.js`;
        const caption = `• Target : ${displayTarget}\n• Total  : ${items.length} pesan\n• File   : ${fileName}`;
        const fileContent = `module.exports = ${JSON.stringify(items, null, 2)};\n`;

        return await sock.sendMessage(m.chat, {
            document: Buffer.from(fileContent, 'utf-8'),
            fileName,
            mimetype: 'application/javascript',
            caption
        }, { quoted: m });
    }
};
