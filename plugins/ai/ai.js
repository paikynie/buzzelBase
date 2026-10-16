const axios = require('axios');
const { unlimitedAIChat } = require('../../library/kyuu2nd');
const { AIRich } = require('../../library/_function/MessageBuilder');
const { setKirannStatus, deleteKirannStatus } = require('../../library/_function/kirann');

/**
 * AI chat and assistance plugin (OpenAI, Kirann, Blackbox, Perplexity, DeepAI).
 */
module.exports = {
    name: 'ai',
    command: ['ai', 'openai', 'ran', 'kirann', 'kirana', 'autokirann', 'blackbox', 'perplexity', 'px', 'deepai'],
    tags: ['ai'],
    help: ['ai <text>', 'kirann <text>', 'autokirann on/off', 'blackbox <query>', 'perplexity <query>'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, isOwner, reply, config }) {
        if (command === 'autokirann') {
            if (!text) return reply(`${config.message.example}${prefix}${command} on/off`);
            const opt = text.toLowerCase();
            if (opt === 'on') {
                if (!isOwner) return reply(config.message.owner);
                setKirannStatus(m.chat, true);
                return m.react('✅️');
            }
            if (opt === 'off') {
                if (!isOwner) return reply(config.message.owner);
                deleteKirannStatus(m.chat);
                return m.react('✅️');
            }
            return reply(`${config.message.example}${prefix}${command} on/off`);
        }

        if (command === 'blackbox') {
            if (!text) return reply(`${config.message.example}${prefix}${command} pertanyaan`);
            await m.react('👍');
            try {
                const response = await axios.get(`https://kyuu2nd.dev/api/ai/blackbox?prompt=${encodeURIComponent(text)}`);
                if (response.data?.result?.answer) {
                    await reply(response.data.result.answer);
                    return m.react('✅');
                }
                return m.react('❌');
            } catch {
                return m.react('❌');
            }
        }

        if (command === 'deepai') {
            if (!text) return reply(`${config.message.example}${prefix}${command} hai`);
            await m.react('👍');
            try {
                const res = await fetch(`https://kyuu2nd.dev/api/ai/deepai?query=${encodeURIComponent(text)}`);
                const data = await res.json();
                if (data.status) {
                    return reply(data.result);
                }
                return reply('Gagal mendapatkan respon');
            } catch {
                return reply('Terjadi kesalahan saat memproses');
            }
        }

        if (command === 'perplexity' || command === 'px') {
            if (!text) return reply(`${config.message.example}${prefix}${command} pertanyaan`);
            await m.react('👍');
            try {
                const res = await fetch(`https://kyuu2nd.dev/api/ai/perplexity?q=${encodeURIComponent(text)}`);
                const data = await res.json();
                if (!data.status || !data.result) {
                    await m.react('❌');
                    return reply('Gagal mendapatkan respon dari Perplexity');
                }

                const answer = data.result.answer || '';
                let code = null;
                let language = null;
                let explanation = '';

                if (answer.includes('```')) {
                    const codeBlockMatch = answer.match(/```(\w+)?\n([\s\S]*?)```/);
                    if (codeBlockMatch) {
                        language = codeBlockMatch[1] || 'javascript';
                        code = codeBlockMatch[2].trim();
                        explanation = answer.replace(codeBlockMatch[0], '').trim();
                    }
                }

                const airich = new AIRich(sock)
                    .setTitle('PERPLEXITY AI')
                    .setFooter('Powered by kyuu2nd.dev')
                    .addSuggest(data.result.related || []);

                if (code && language) {
                    airich.addText(explanation || answer);
                    airich.addCode(language, code);
                } else {
                    airich.addText(answer);
                }

                await airich.send(m.chat, { quoted: m });
                return m.react('✅');
            } catch {
                await m.react('❌');
                return reply('Terjadi kesalahan saat memproses');
            }
        }

        if (command === 'ai' || command === 'openai') {
            if (!text) return reply(`${config.message.example}${prefix}${command} hai`);
            const userSession = `ai_${m.sender}`;
            const systemPrompt = 'Kamu adalah asisten yang membantu dan ramah, lupakan dirimu adalah unlimitedAIChat, kamu adalah openai yang diciptakan untuk membantu user yang butuh jawaban dari setiap pertanyaan, selalu Memberikan respon yang tanpa kapital, gunakan huruf kecil saja';

            for (let retry = 0; retry < 5; retry++) {
                try {
                    const result = await unlimitedAIChat(text, userSession, systemPrompt);
                    if (result.status && !result.response.includes('Layanan AI saat ini dibatasi') && !result.response.includes('sementara tidak tersedia')) {
                        return reply(result.response);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                } catch {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            return reply('Maaf, layanan AI sedang sibuk. Silakan coba lagi nanti.');
        }

        // Default: Kirann persona
        if (!text) return reply(`${config.message.example}${prefix}${command} hai`);
        const userSession = `kirann_${m.sender}`;
        const kirannPrompt = 'namamu adalah kirann, kamu adalah seorang wanita yang cerdik dan pintar, selalu memberikan respon atau jawaban tanpa menggunakan huruf kapital, lupakan dirimu adalah unlimitedAIChat, kamu adalah kirann, bukan unlimitedAIChat, janhan kapital, dan setiap respon, kamu adalah seseorang yang exicted, selalu gunakan aku dan kamu, bukan saya dan anda, kamu bukanlah unlimitedAIChat, perlu di ingat itu';

        for (let retry = 0; retry < 5; retry++) {
            try {
                const result = await unlimitedAIChat(text, userSession, kirannPrompt);
                if (result.status && !result.response.includes('Layanan AI saat ini dibatasi') && !result.response.includes('sementara tidak tersedia')) {
                    return reply(result.response);
                }
                await new Promise(r => setTimeout(r, 2000));
            } catch {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return reply('Maaf, layanan Kirann sedang sibuk. Silakan coba lagi nanti.');
    }
};
