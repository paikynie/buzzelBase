const { updateSetting, config } = require('../../settings/config');

/**
 * Plugin to toggle no-prefix execution mode.
 */
module.exports = {
    name: 'noprefix',
    command: ['noprefix', 'nopref'],
    tags: ['owner'],
    help: ['noprefix on/off'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { args, reply, prefix, config: cfg }) {
        const activeConfig = cfg || config;
        const displayPrefix = prefix || (activeConfig.prefixes?.[0] || '.');
        const arg = args ? args[0]?.toLowerCase() : undefined;

        if (!arg) {
            const status = activeConfig.noprefix ? 'ON' : 'OFF';
            return reply(
                `No-Prefix Mode: *${status}*\n\n` +
                `Usage: \`${displayPrefix}noprefix on\` or \`${displayPrefix}noprefix off\``
            );
        }

        if (['on', 'true', '1'].includes(arg)) {
            const success = typeof activeConfig.updateSetting === 'function'
                ? activeConfig.updateSetting('noprefix', true)
                : updateSetting('noprefix', true);
            if (!success) return reply('❌ Gagal mengupdate status noprefix.');
            return reply('✅ No-Prefix Mode is now *ON*. Commands can be executed without a prefix.');
        }

        if (['off', 'false', '0'].includes(arg)) {
            const success = typeof activeConfig.updateSetting === 'function'
                ? activeConfig.updateSetting('noprefix', false)
                : updateSetting('noprefix', false);
            if (!success) return reply('❌ Gagal mengupdate status noprefix.');
            return reply('❌ No-Prefix Mode is now *OFF*. Commands require a prefix.');
        }

        return reply(`Usage: \`${displayPrefix}noprefix on\` or \`${displayPrefix}noprefix off\``);
    }
};
