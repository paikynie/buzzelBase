const { getGroupSetting, setGroupSetting } = require('../../library/_function/group');

/**
 * Group management and utility plugin.
 */
module.exports = {
    name: 'group',
    command: ['hidetag', 'ht', 'tagall', 'welcome', 'goodbye', 'am', 'alight-motion'],
    tags: ['group'],
    help: ['hidetag <teks>', 'tagall <teks>', 'welcome on/off', 'goodbye on/off', 'am send/verif'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, isGroup, isAdmins, isGroupOwner, participants, reply, config }) {
        if (command === 'am' || command === 'alight-motion') {
            const amArgs = text.trim().split(/\s+/);
            const subCommand = amArgs[0]?.toLowerCase();

            if (subCommand === 'send') {
                const email = amArgs[1];
                if (!email) return reply(`${config.message.example}${prefix}${command} send email@domain.com`);
                try {
                    const response = await fetch(`https://kyuu2nd.dev/api/alight-motion/am-send?email=${email}`);
                    const data = await response.json();
                    if (data.status === false && data.result === 'Access denied. IP not whitelisted.') {
                        return reply('IP tidak diizinkan, silakan hubungi owner');
                    }
                    if (data.status) {
                        const otp = Math.floor(1000 + Math.random() * 9000);
                        global.tempOtp = global.tempOtp || {};
                        global.tempOtp[email] = { otp, timestamp: Date.now() };
                        return reply(`${data.result.message}\n\nEmail: ${data.result.data.email}\nOTP: ${otp}\n\nNote: Cek email kamu, copy link verifikasi, lalu ketik:\n> ${prefix}${command} verif ${otp} link_verifikasi`);
                    }
                } catch {
                    return reply('Error: Server sedang sibuk');
                }
            } else if (subCommand === 'verif') {
                const otp = amArgs[1];
                const link = amArgs[2];
                if (!otp || !link) return reply(`${config.message.example}${prefix}${command} verif kode_otp link_verifikasi`);

                let email = null;
                for (const [key, value] of Object.entries(global.tempOtp || {})) {
                    if (value.otp == otp) {
                        email = key;
                        break;
                    }
                }
                if (!email) return reply('Kode OTP tidak valid atau sudah kadaluarsa');

                try {
                    const response = await fetch(`https://kyuu2nd.dev/api/alight-motion/am-verif?email=${email}&link=${encodeURIComponent(link)}`);
                    const data = await response.json();
                    if (data.status === false && data.result === 'Access denied. IP not whitelisted.') {
                        return reply('IP tidak diizinkan, silakan hubungi owner');
                    }
                    if (data.status) {
                        const duration = data.result.data.duration === '1_year' ? '1y' : data.result.data.duration;
                        delete global.tempOtp[email];
                        return reply(`${data.result.message}\n\nEmail: ${data.result.data.email}\nDurasi: ${duration}\n\nNote: Akun premium aktif, silakan login.`);
                    }
                } catch {
                    return reply('Error: Server sedang sibuk');
                }
            }
            return reply(`Contoh penggunaan:\n${prefix}${command} send email@domain.com\n${prefix}${command} verif kode link`);
        }

        if (!isGroup) return reply(config.message.group);
        if (!isAdmins && !isGroupOwner) return reply(config.message.admin);

        if (command === 'welcome') {
            if (!text) {
                const status = getGroupSetting(m.chat, 'welcome', false);
                return reply(`Welcome status: ${status ? 'ON' : 'OFF'}\nUsage: ${prefix}welcome on/off`);
            }
            if (text === 'on') {
                setGroupSetting(m.chat, 'welcome', true);
                return reply('Welcome message activated');
            }
            if (text === 'off') {
                setGroupSetting(m.chat, 'welcome', false);
                return reply('Welcome message deactivated');
            }
            return reply(`Usage: ${prefix}welcome on/off`);
        }

        if (command === 'goodbye') {
            if (!text) {
                const status = getGroupSetting(m.chat, 'goodbye', false);
                return reply(`Goodbye status: ${status ? 'ON' : 'OFF'}\nUsage: ${prefix}goodbye on/off`);
            }
            if (text === 'on') {
                setGroupSetting(m.chat, 'goodbye', true);
                return reply('Goodbye message activated');
            }
            if (text === 'off') {
                setGroupSetting(m.chat, 'goodbye', false);
                return reply('Goodbye message deactivated');
            }
            return reply(`Usage: ${prefix}goodbye on/off`);
        }

        // hidetag / tagall
        const mentionedJids = (participants || []).map(p => p.phoneNumber || p.id).filter(Boolean);
        const content = {
            extendedTextMessage: {
                text: `@12036342721111@g.us ${text || ''}`.trim(),
                previewType: 'NONE',
                contextInfo: {
                    mentionedJid: mentionedJids,
                    groupMentions: [{
                        groupJid: '12036342721111@g.us',
                        groupSubject: 'semua'
                    }],
                    forwardOrigin: 'UNKNOWN'
                },
                inviteLinkGroupTypeV2: 'DEFAULT'
            },
            messageContextInfo: {
                messageSecret: 'jPMuGB4+4rSOnfvbRe6/nRNbQI/uhrBE2xdEoIhMmks='
            }
        };

        return await sock.relayMessage(m.chat, content, {
            messageId: sock.generateMessageTag()
        });
    }
};
