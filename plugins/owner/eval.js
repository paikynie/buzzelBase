const { runUserCode } = require('../../library/evalRunner');

/**
 * Plugin to execute JavaScript code dynamically from chat.
 */
module.exports = {
    name: 'eval',
    command: ['>', 'eval', 'ev', '=>', '!!'],
    tags: ['owner'],
    help: ['eval <code>', '> <code>'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, body, prefix, reply, store, config }) {
        let code = text;
        if (!code) {
            const trimmed = (body || '').trim();
            if (trimmed.startsWith('=>')) {
                code = trimmed.slice(2).trim();
            } else if (trimmed.startsWith('>')) {
                code = trimmed.slice(1).trim();
            } else if (trimmed.startsWith('!!')) {
                code = trimmed.slice(2).trim();
            }
        }

        if (!code) return reply('*Masukkan kode setelah prefix eval!*');

        try {
            const output = await runUserCode(code, m, sock, store, config);
            return reply(output);
        } catch (err) {
            return reply(`❌ Kode gagal dijalankan: ${err?.message || err}`);
        }
    }
};
