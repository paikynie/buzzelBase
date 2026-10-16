const axios = require('axios');
const yts = require('yt-search');
const { capcutdl } = require('../../library/kyuu2nd');

/**
 * Media downloader plugin (TikTok, CapCut, Instagram, YouTube Play, SendTheSong).
 */
module.exports = {
    name: 'downloader',
    command: ['tiktok', 'tt', 'capcut', 'igdl', 'instagram', 'play', 'sendthesong', 'sts'],
    tags: ['downloader'],
    help: ['tiktok <url>', 'capcut <url>', 'igdl <url>', 'play <judul>', 'sendthesong <penerima|pesan|lagu>'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, reply, config }) {
        if (command === 'tiktok' || command === 'tt') {
            if (!text) return reply(`${config.message.example}${prefix}${command} url tiktok`);
            const tiktokRegex = /(https?:\/\/)?(www\.)?(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|t\.tiktok\.com)\/[^\s]+/i;
            if (!tiktokRegex.test(text)) return reply('URL TikTok tidak valid');

            await m.react('👍');
            try {
                const encodedParams = new URLSearchParams();
                encodedParams.set('url', text);
                encodedParams.set('hd', '1');
                const response = await axios({
                    method: 'POST',
                    url: 'https://tikwm.com/api/',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Cookie': 'current_language=en',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
                    },
                    data: encodedParams
                });

                const videos = response.data.data;
                if (videos.images && videos.images.length > 0) {
                    for (const imgUrl of videos.images) {
                        await sock.sendMessage(m.chat, { image: { url: imgUrl } }, { quoted: m });
                    }
                } else if (videos.play) {
                    await sock.sendMessage(m.chat, {
                        video: { url: videos.play },
                        caption: videos.title || ''
                    }, { quoted: m });
                } else {
                    return reply('Gagal mengambil konten TikTok');
                }
                return m.react('✅');
            } catch (err) {
                await m.react('❌');
                return reply(`Error: ${err.message}`);
            }
        }

        if (command === 'capcut') {
            if (!text) return reply(`${config.message.example}${prefix}${command} url capcut`);
            const capcutRegex = /(https?:\/\/)?(www\.)?capcut\.com\/[^\s]+/i;
            if (!capcutRegex.test(text)) return reply('URL Capcut tidak valid');

            await m.react('👍');
            const result = await capcutdl(text);
            if (result.code !== 200) return reply('Gagal mengambil video Capcut');

            return sock.sendMessage(m.chat, {
                video: { url: result.fullVideoUrl },
                caption: `*${result.title}*\nAuthor: ${result.authorName}`
            }, { quoted: m });
        }

        if (command === 'igdl' || command === 'instagram') {
            if (!text) return reply(`${config.message.example}${prefix}${command} url instagram`);
            const igRegex = /(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|tv)\/[a-zA-Z0-9_-]+/i;
            if (!igRegex.test(text)) return reply('URL Instagram tidak valid');

            await m.react('👍');
            try {
                const res = await fetch(`https://kyuu2nd.dev/api/download/instagram?url=${encodeURIComponent(text)}`);
                const data = await res.json();
                if (!data.status || !data.result?.media) return reply('Gagal mengambil konten Instagram');

                const caption = data.result.caption || '';
                for (const media of data.result.media) {
                    if (media.type === 'image') {
                        await sock.sendMessage(m.chat, { image: { url: media.url }, caption }, { quoted: m });
                    } else if (media.type === 'video') {
                        await sock.sendMessage(m.chat, { video: { url: media.url }, caption }, { quoted: m });
                    }
                }
                return m.react('✅');
            } catch (err) {
                await m.react('❌');
                return reply(`Error: ${err.message}`);
            }
        }

        if (command === 'play') {
            if (!text) return reply(`${config.message.example}${prefix}${command} judul lagu`);
            await m.react('👍');

            try {
                const search = await yts(text);
                if (!search.videos?.length) return reply('Lagu tidak ditemukan');

                const videoUrl = search.videos[0].url;
                const response = await fetch(`https://kyuu2nd.dev/api/download/sptzx-ytdl?url=${encodeURIComponent(videoUrl)}&type=audio`);
                const data = await response.json();

                const audioBuffer = await axios.get(data.result.url, { responseType: 'arraybuffer' });
                await sock.sendAudio(m.chat, Buffer.from(audioBuffer.data), { ptt: false, quoted: m });
                return m.react('✅');
            } catch (err) {
                await m.react('❌');
                return reply(`Error: ${err.message}`);
            }
        }

        if (command === 'sendthesong' || command === 'sts') {
            const inputArgs = text.trim().split('|');
            if (inputArgs.length < 3) {
                return reply(`Contoh penggunaan:\n${prefix}${command} Penerima | Pesan | Judul Lagu`);
            }
            const recipient = inputArgs[0].trim();
            const messageText = inputArgs[1].trim();
            const songQuery = inputArgs[2].trim();

            await m.react('👍');
            try {
                const turnstileRes = await axios.get('https://kyuu2nd.dev/api/tools/turnstile-min', {
                    params: {
                        url: 'https://api.sendthesong.xyz/api/posts',
                        sitekey: '0x4AAAAAAB5qv2NRGfnIDafe'
                    }
                });
                const token = turnstileRes.data?.result?.token;

                const res = await fetch('https://api.sendthesong.xyz/api/posts', {
                    method: 'POST',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                        'Content-Type': 'application/json',
                        'origin': 'https://sendthesong.xyz',
                        'referer': 'https://sendthesong.xyz/'
                    },
                    body: JSON.stringify({
                        message: messageText,
                        recipient,
                        turnstileToken: token,
                        song: songQuery
                    })
                });
                const data = await res.json();
                if (data.status) {
                    await reply(`✅ Pesan berhasil terkirim ke SendTheSong!\nID: ${data.data?.id || '-'}`);
                    return m.react('✅');
                }
                return reply(data.message || 'Gagal mengirim lagu ke SendTheSong');
            } catch (err) {
                await m.react('❌');
                return reply(`Error: ${err.message}`);
            }
        }
    }
};
