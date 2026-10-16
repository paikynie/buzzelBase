const axios = require('axios');
const FormData = require('form-data');
const { AIRich } = require('../../library/_function/MessageBuilder');

/**
 * Utility tools plugin (Sticker maker, HDR enhancement, Pinterest search, ViewOnce reader).
 */
module.exports = {
    name: 'tools',
    command: ['s', 'sticker', 'hd', 'hdr', 'pinterest', 'pin', 'getbps'],
    tags: ['tools'],
    help: ['s (caption media)', 'hd (reply foto)', 'pinterest <query>', 'getbps (reply viewOnce)'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, isOwner, reply, config }) {
        if (command === 'getbps') {
            if (!isOwner) return reply(config.message.owner);
            if (!m.quoted) return reply('Reply pesan viewOnce');
            return m.quoted.copyNForward(m.sender, true, { readViewOnce: true });
        }

        if (command === 'hd' || command === 'hdr') {
            const mime = (m.quoted?.msg || m.quoted)?.mimetype || '';
            if (!m.quoted || !/image/.test(mime)) {
                return reply(`${config.message.example}${prefix}${command} (reply foto)`);
            }

            const imageBuffer = await m.quoted.download();
            await m.react('👍');

            const form = new FormData();
            form.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

            const res = await fetch('https://kyuu2nd.dev/api/generator/hdr?scale=2', {
                method: 'POST',
                body: form,
                headers: form.getHeaders()
            });
            const data = await res.json();

            if (data.status) {
                return sock.sendMessage(m.chat, {
                    image: { url: data.result.url },
                    caption: `Scale: ${data.result.scale}x`
                }, { quoted: m });
            }
            return reply('Gagal memproses gambar');
        }

        if (command === 'pinterest' || command === 'pin') {
            if (!text) return reply(`${config.message.example}${prefix}${command} kata kunci`);
            await m.react('👍');
            try {
                const response = await axios.get(`https://kyuu2nd.dev/api/search/pinterest?query=${encodeURIComponent(text)}`);
                const results = response.data?.result?.results;
                if (!results || !results.length) return reply('Gambar tidak ditemukan');

                const randomIndex = Math.floor(Math.random() * results.length);
                const imageUrl = results[randomIndex].image_736x.url;

                await new AIRich(sock)
                    .setTitle('PINTEREST SEARCH')
                    .addImage(imageUrl)
                    .send(m.chat, { quoted: m });
                return m.react('✅');
            } catch {
                return m.react('❌');
            }
        }

        // Sticker creation
        const qmsg = m.quoted ? (m.quoted.msg || m.quoted) : (m.msg || m);
        const mime = qmsg?.mimetype || '';

        if (m.quoted && m.quoted.mtype === 'stickerMessage') {
            try {
                const optArgs = text.trim().split(/\s+/);
                const option = optArgs[0].toLowerCase();
                const targetJid = optArgs[1] || m.chat;

                const quotedMsg = m.quoted.msg || m.quoted;
                const stickerData = JSON.parse(JSON.stringify(quotedMsg));

                if (option === '-prem') {
                    stickerData.premium = 1;
                    stickerData.isAiSticker = false;
                } else if (option === '-ai') {
                    stickerData.premium = 0;
                    stickerData.isAiSticker = true;
                }

                const content = { stickerMessage: stickerData };
                if (stickerData.contextInfo?.mediaDomainInfo) {
                    content.messageContextInfo = {
                        messageSecret: 'UFEbObNrUoL6YvMa5uZjBJi4Nae1N0chn4YXPLRdiV4='
                    };
                }
                return await sock.relayMessage(targetJid, content, {});
            } catch (err) {
                return reply(err.message);
            }
        }

        if (/image/.test(mime)) {
            const media = await sock.downloadMediaMessage(qmsg);
            return await sock.sendImageAsSticker(m.chat, media, m, {
                packname: config.sticker.packname,
                author: config.sticker.author
            });
        }

        if (/video/.test(mime)) {
            if (qmsg.seconds > 11) return reply('Video terlalu panjang untuk dijadikan stiker (maks 11 detik)');
            const media = await sock.downloadMediaMessage(qmsg);
            return await sock.sendVideoAsSticker(m.chat, media, m, {
                packname: config.sticker.packname,
                author: config.sticker.author
            });
        }

        return reply(`Kirim atau balas media dengan caption: ${prefix}${command} (-ai/-prem)`);
    }
};
