const { updateSetting, config } = require('../../settings/config');

const MAX_PREFIX_LENGTH = 5;

/**
 * Plugin to add a new prefix to the bot configuration.
 */
module.exports = {
    name: 'addprefix',
    command: ['addprefix', 'tambahprefix'],
    tags: ['owner'],
    help: ['addprefix <prefix>'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { args, reply, prefix, config: cfg }) {
        const activeConfig = cfg || config;
        const currentPrefixes = Array.isArray(activeConfig.prefixes) ? activeConfig.prefixes : ['.'];
        const displayPrefix = prefix || currentPrefixes[0] || '.';
        const raw = args?.[0];

        if (!raw) {
            return reply(
                `Usage: \`${displayPrefix}addprefix <prefix>\`\n\n` +
                `Prefix aktif saat ini:\n${currentPrefixes.map((p) => `- \`${p}\``).join('\n')}`
            );
        }

        const newPrefix = raw.trim();

        if (!newPrefix) return reply('❌ Prefix tidak boleh kosong.');
        if (/\s/.test(newPrefix)) return reply('❌ Prefix tidak boleh mengandung spasi.');
        if (newPrefix.length > MAX_PREFIX_LENGTH) return reply(`❌ Prefix maksimal ${MAX_PREFIX_LENGTH} karakter.`);
        if (currentPrefixes.includes(newPrefix)) return reply(`⚠️ Prefix \`${newPrefix}\` sudah terdaftar.`);

        const updatedList = [...currentPrefixes, newPrefix];
        const success = typeof activeConfig.updateSetting === 'function'
            ? activeConfig.updateSetting('prefixes', updatedList)
            : updateSetting('prefixes', updatedList);

        if (!success) {
            return reply('❌ Gagal menyimpan prefix ke config.js.');
        }

        return reply(
            `✅ Prefix \`${newPrefix}\` berhasil ditambahkan.\n\n` +
            `Prefix aktif sekarang:\n${activeConfig.prefixes.map((p) => `- \`${p}\``).join('\n')}`
        );
    }
};
