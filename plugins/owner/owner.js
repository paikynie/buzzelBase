const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const { getContentType } = require('@whiskeysockets/baileys');

/**
 * Bot owner control plugin (Eval, Exec, Backup, Profile Picture, Status Update).
 */
module.exports = {
    name: 'owner',
    command: ['exec', 'ex', 'backup', 'setppbot', 'setbotpp', 'upswgc', 'uploadstatus', 'statusgc', 'upstatus'],
    tags: ['owner'],
    help: ['exec <shell>', 'backup', 'setppbot (reply foto)', 'upswgc <teks/media>'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, args, isGroup, reply, config, store }) {
        if (command === 'exec' || command === 'ex') {
            if (!text) return reply(`${config.message.example}${prefix}${command} ls`);
            return exec(text, (err, stdout, stderr) => {
                const output = err ? String(err) : (stdout || stderr || 'Done');
                reply(output);
            });
        }

        if (command === 'backup') {
            await reply('Tunggu sebentar, sedang membuat file backup...');
            const zipPath = path.join(os.tmpdir(), `backup_${Date.now()}.zip`);
            return exec(`zip -r ${zipPath} . -x "package-lock.json" "node_modules/*" ".npm/*" "sessions/*" ".git/*"`, {
                cwd: process.cwd()
            }, async (err) => {
                if (err) return reply(`Error: ${err.message}`);
                await sock.sendMessage(m.chat, {
                    document: fs.readFileSync(zipPath),
                    fileName: path.basename(zipPath),
                    mimetype: 'application/zip',
                    caption: '📦 *Backup script berhasil dibuat!*'
                }, { quoted: m });
                try {
                    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                } catch {}
            });
        }

        if (command === 'setppbot' || command === 'setbotpp') {
            const mime = (m.quoted?.msg || m.quoted)?.mimetype || '';
            if (!m.quoted || !/image/.test(mime)) {
                return reply(`${config.message.example}${prefix}${command} (reply foto)`);
            }
            const media = await sock.downloadMediaMessage(m.quoted);
            const tempPath = path.join(os.tmpdir(), `ppbot_${Date.now()}.jpg`);
            fs.writeFileSync(tempPath, media);
            await sock.updateProfilePicture(sock.user.id, { url: tempPath });
            try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch {}
            return reply('Profile picture bot berhasil diubah');
        }

        if (command === 'upswgc' || command === 'uploadstatus' || command === 'statusgc' || command === 'upstatus') {
            if (!isGroup) return reply(config.message.group);
            await m.react('👍');

            if (text) {
                await sock.relayMessage(m.chat, {
                    groupStatusMessageV2: {
                        message: { conversation: text }
                    }
                }, {});
                return m.react('✅');
            }

            if (!m.quoted) return reply(`${config.message.example}${prefix}${command} (reply pesan)`);

            const type = m.quoted.mtype || getContentType(m.quoted.message);
            const allowedTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'conversation', 'extendedTextMessage'];
            if (!allowedTypes.includes(type)) return m.react('❌');

            const payload = { [type]: m.quoted.message[type] };
            await sock.relayMessage(m.chat, {
                groupStatusMessageV2: { message: payload }
            }, {});
            return m.react('✅');
        }
    }
};
