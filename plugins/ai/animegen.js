const FormData = require('form-data');
const { AIRich } = require('../../library/_function/MessageBuilder');

/**
 * AI image generator and transformer plugin.
 */
module.exports = {
    name: 'animegen',
    command: ['text2anime', 'animegen', 'bgapi', 'greenpink', 'hero'],
    tags: ['ai'],
    help: ['animegen <prompt>', 'bgapi (reply foto)', 'greenpink (reply foto)'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, reply, config }) {
        if (command === 'bgapi') {
            if (!m.quoted || !/image/.test(m.quoted.mtype || '')) {
                return reply(`${config.message.example}${prefix}${command} (reply foto)`);
            }
            const imageBuffer = await m.quoted.download();
            await m.react('👍');

            const form = new FormData();
            form.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

            const res = await fetch('https://kyuu2nd.dev/api/generator/bgapi', {
                method: 'POST',
                body: form,
                headers: form.getHeaders()
            });
            const data = await res.json();
            return sock.sendMessage(m.chat, {
                image: { url: data.result.url },
                caption: 'Powered by kyuu2nd.dev'
            }, { quoted: m });
        }

        if (command === 'greenpink' || command === 'hero') {
            if (!m.quoted || !/image/.test(m.quoted.mtype || '')) {
                return reply(`${config.message.example}${prefix}${command} (reply foto)`);
            }
            const imageBuffer = await m.quoted.download();
            const form = new FormData();
            form.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

            const res = await fetch('https://kyuu2nd.dev/api/generator/greenpink-hero', {
                method: 'POST',
                body: form,
                headers: form.getHeaders()
            });
            const data = await res.json();
            if (data.status) {
                return sock.sendMessage(m.chat, {
                    image: { url: data.result.url },
                    caption: 'Powered by kyuu2nd.dev'
                }, { quoted: m });
            }
            return reply('Gagal memproses gambar');
        }

        // text2anime / animegen
        if (!text) return reply(`${config.message.example}${prefix}${command} prompt`);
        await m.react('👍');

        const sessionHash = Math.random().toString(36).slice(2, 12);
        const negPrompt = 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, signature, watermark, blurry';

        try {
            const joinRes = await fetch('https://asahina2k-animagine-xl-4-0.hf.space/queue/join?__theme=system', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    data: [text, negPrompt, Math.floor(Math.random() * 1e9), 1024, 1024, 5, 28, 'Euler a', '1024 x 1024', '(None)', false, 0.55, 1.5, true],
                    event_data: null,
                    fn_index: 5,
                    trigger_id: 43,
                    session_hash: sessionHash
                })
            });
            const { event_id } = await joinRes.json();
            const streamRes = await fetch(`https://asahina2k-animagine-xl-4-0.hf.space/queue/data?session_hash=${sessionHash}`, {
                headers: { 'Accept': 'text/event-stream' }
            });

            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let imageUrl = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);

                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.event_id === event_id && data.success && data.output?.data?.[0]) {
                            const out = data.output.data[0];
                            if (Array.isArray(out) && out[0]?.image?.url) {
                                imageUrl = out[0].image.url;
                                break;
                            }
                        }
                    } catch {}
                }
                if (imageUrl) break;
            }

            if (imageUrl) {
                await new AIRich(sock)
                    .setTitle('AI TEXT TO ANIME')
                    .addImage(imageUrl, { resolveUrl: true })
                    .send(m.chat, { quoted: m });
                return m.react('✅');
            }
            return m.react('❌');
        } catch {
            return m.react('❌');
        }
    }
};
