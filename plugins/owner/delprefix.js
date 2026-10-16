const { updateSetting, config } = require('../../settings/config');

/**
 * Plugin to delete a prefix by character or index.
 */
module.exports = {
    name: 'delprefix',
    command: ['delprefix', 'hapusprefix'],
    tags: ['owner'],
    help: ['delprefix <prefix/nomor>'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { args, reply, prefix, config: cfg }) {
        const activeConfig = cfg || config;
        const list = Array.isArray(activeConfig.prefixes) ? activeConfig.prefixes : ['.'];
        const displayPrefix = prefix || list[0] || '.';
        const input = args?.[0]?.trim();

        if (!input) {
            return reply(
                `Usage: \`${displayPrefix}delprefix <prefix|nomor>\`\n\n` +
                `Daftar prefix:\n${list.map((p, i) => `${i + 1}. \`${p}\``).join('\n')}`
            );
        }

        if (list.length <= 1) {
            return reply('❌ Tidak bisa menghapus satu-satunya prefix yang tersisa.');
        }

        let target;

        if (/^\d+$/.test(input)) {
            const num = parseInt(input, 10);

            if (num < 1 || num > list.length) {
                return reply(`❌ Nomor urut tidak valid. Rentang yang tersedia: 1-${list.length}.`);
            }

            target = list[num - 1];
        } else if (list.includes(input)) {
            target = input;
        } else {
            return reply(`❌ Prefix \`${input}\` tidak ada dalam daftar.`);
        }

        const updatedList = list.filter((p) => p !== target);
        const success = typeof activeConfig.updateSetting === 'function'
            ? activeConfig.updateSetting('prefixes', updatedList)
            : updateSetting('prefixes', updatedList);

        if (!success) {
            return reply('❌ Gagal menyimpan perubahan ke config.js.');
        }

        return reply(
            `🗑️ Prefix \`${target}\` berhasil dihapus.\n\n` +
            `Prefix aktif sekarang:\n${activeConfig.prefixes.map((p, i) => `${i + 1}. \`${p}\``).join('\n')}`
        );
    }
};
