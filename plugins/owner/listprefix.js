const config = require('../../settings/config');

/**
 * Plugin to display active prefixes and no-prefix mode status.
 */
module.exports = {
    name: 'listprefix',
    command: ['listprefix', 'daftarprefix', 'prefixlist'],
    tags: ['owner'],
    help: ['listprefix'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { reply, config: cfg }) {
        const activeConfig = cfg || config;
        const listPrefixes = Array.isArray(activeConfig.prefixes) ? activeConfig.prefixes : ['.'];
        const mode = activeConfig.noprefix
            ? 'Aktif — semua command bisa dipanggil tanpa prefix'
            : 'Nonaktif — command wajib pakai prefix';

        const list = listPrefixes.map((p, i) => `${i + 1}. \`${p}\``).join('\n');

        return reply(
            `📋 *Daftar Prefix*\n\n` +
            `${list}\n\n` +
            `Total: ${listPrefixes.length}\n` +
            `Mode tanpa prefix: ${mode}`
        );
    }
};
