const fs = require('fs');
const chalk = require('chalk');
const { getContentType } = require('@whiskeysockets/baileys');
const plugins = require('./library/plugins');
const { unlimitedAIChat } = require('./library/kyuu2nd');
const { getKirannStatus } = require('./library/_function/kirann');

/**
 * Main message handler and plugin dispatcher.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {object} m Serialized message
 * @param {object} chatUpdate Raw chat update event
 * @param {object} store SQLite store instance
 */
module.exports = async function messageHandler(sock, m, chatUpdate, store) {
    try {
        const config = require('./settings/config');

        const body = (
            m.mtype === 'conversation' ? m.message.conversation :
            m.mtype === 'imageMessage' ? m.message.imageMessage?.caption :
            m.mtype === 'videoMessage' ? m.message.videoMessage?.caption :
            m.mtype === 'extendedTextMessage' ? m.message.extendedTextMessage?.text :
            m.mtype === 'buttonsResponseMessage' ? m.message.buttonsResponseMessage?.selectedButtonId :
            m.mtype === 'listResponseMessage' ? m.message.listResponseMessage?.singleSelectReply?.selectedRowId :
            m.mtype === 'templateButtonReplyMessage' ? m.message.templateButtonReplyMessage?.selectedId :
            m.mtype === 'interactiveResponseMessage' ? (JSON.parse(m.msg?.nativeFlowResponseMessage?.paramsJson || '{}').id || '') :
            m.text || ''
        ) || '';

        const sender = m.key.fromMe
            ? (sock.user.id.split(':')[0] + '@s.whatsapp.net')
            : (m.key.participant || m.key.remoteJid || '');

        const senderNumber = sender.split('@')[0];
        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        const botNumber = await sock.decodeJid(sock.user.id);
        const isBot = botNumber.includes(senderNumber);

        const prefixes = Array.isArray(config.prefixes) && config.prefixes.length > 0 ? config.prefixes : ['.'];
        const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length);
        const trimmedBody = body.trim();
        const matchedPrefix = sortedPrefixes.find(p => trimmedBody.startsWith(p));
        const firstWord = trimmedBody.split(/\s+/)[0]?.toLowerCase() || '';
        const isEvalShortcut = trimmedBody.startsWith('=>') ? '=>' : (trimmedBody.startsWith('>') ? '>' : null);
        const isCmd = Boolean(matchedPrefix) || Boolean(isEvalShortcut) || (Boolean(config.noprefix) && Boolean(plugins.find(firstWord)));
        const prefix = matchedPrefix || (isCmd ? '' : (prefixes[0] || '.'));

        let command = '';
        let args = [];
        let text = '';

        if (matchedPrefix) {
            const afterPrefix = trimmedBody.slice(matchedPrefix.length).trim();
            command = afterPrefix.split(/\s+/)[0]?.toLowerCase() || '';
            args = afterPrefix.split(/\s+/).slice(1);
            text = args.join(' ');
        } else if (isEvalShortcut) {
            command = isEvalShortcut;
            text = trimmedBody.slice(isEvalShortcut.length).trim();
            args = text.split(/\s+/).filter(Boolean);
        } else if (isCmd) {
            command = firstWord;
            args = trimmedBody.split(/\s+/).slice(1);
            text = args.join(' ');
        }
        const pushname = m.pushName || 'No Name';

        const storeLid = sock.signalRepository?.lidMapping;
        let myPn = storeLid ? await storeLid.getPNForLID(sender) : null;
        myPn = myPn ? (myPn.split(':')[0] + '@s.whatsapp.net') : null;

        const groupMetadata = isGroup ? await sock.groupMetadata(m.chat).catch(() => ({})) : {};
        const participants = groupMetadata.participants || [];
        const groupAdminsList = participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => p.phoneNumber || p.id);

        const isAdmins = groupAdminsList.includes(sender) || (myPn && groupAdminsList.includes(myPn));
        const isGroupOwner = groupMetadata.ownerPn === sender || (myPn && groupMetadata.ownerPn === myPn);

        let ownerNumber = null;
        if (myPn) {
            ownerNumber = myPn.split('@')[0];
        } else if (sender.includes('@s.whatsapp.net')) {
            ownerNumber = sender.split('@')[0];
        } else {
            ownerNumber = senderNumber;
        }

        const ownerClean = ownerNumber ? ownerNumber.split(':')[0].replace(/\D/g, '') : '';
        const senderClean = senderNumber ? senderNumber.split(':')[0].replace(/\D/g, '') : '';
        const ownerList = (config.owner || []).map(o => String(o).replace(/\D/g, ''));
        const isOwner = m.key.fromMe || ownerList.includes(ownerClean) || ownerList.includes(senderClean);

        if (config.status.public === false && !isOwner) return;
        if (config.status.onlyGroup === true && !isGroup && !isOwner) return;

        /**
         * Helper function to reply to current message with context info.
         * @param {string} replyText
         */
        async function reply(replyText) {
            return await sock.sendMessage(m.chat, {
                text: replyText,
                contextInfo: {
                    isQuestion: true,
                    isForwarded: true,
                    mentionedJid: [sender],
                    forwardingScore: 666
                }
            }, {
                quoted: m
            });
        }

        if (isCmd) {
            console.log(chalk.hex('#6c5ce7')('# New Message'));
            console.log(`- Tanggal  : ${chalk.white(new Date().toLocaleString())}`);
            console.log(`- Pesan    : ${chalk.white(command)}`);
            console.log(`- Pengirim : ${chalk.white(pushname)}`);
            console.log(`- JID      : ${chalk.white(senderNumber)}`);
            console.log('ㅤ\n');
        }

        // Plugin Dispatcher
        if (isCmd && command) {
            const plugin = plugins.find(command);
            if (plugin) {
                if (plugin.isOwner && !isOwner) {
                    return reply(config.message.owner);
                }
                if (plugin.isGroup && !isGroup) {
                    return reply(config.message.group);
                }
                if (plugin.isAdmins && !isAdmins && !isGroupOwner && !isOwner) {
                    return reply(config.message.admin);
                }
                if (plugin.isPrivate && isGroup) {
                    return reply('Perintah ini hanya dapat digunakan di private chat.');
                }

                return await plugin.run(sock, m, {
                    body,
                    command,
                    args,
                    text,
                    prefix,
                    isOwner,
                    isGroup,
                    isAdmins,
                    isGroupOwner,
                    isBot,
                    sender,
                    senderNumber,
                    pushname,
                    groupMetadata,
                    participants,
                    reply,
                    config,
                    store,
                    chatUpdate
                });
            }
        }

        // Kirann Auto AI response when quoted
        if (m.isBaileys && m.fromMe) return;
        if (!m.text) return;

        const isKirannActive = getKirannStatus(m.chat);
        if (!isKirannActive || !m.quoted) return;

        const quotedSender = m.quoted.sender || '';
        let quotedNumber = null;
        if (quotedSender.includes('@lid') && storeLid) {
            const pn = await storeLid.getPNForLID(quotedSender);
            if (pn) quotedNumber = pn.split(':')[0].split('@')[0];
        } else if (quotedSender.includes('@s.whatsapp.net')) {
            quotedNumber = quotedSender.split('@')[0];
        }

        const botNumberRaw = botNumber.split('@')[0];
        if (quotedNumber !== botNumberRaw) return;
        if (isCmd || prefixes.some(p => m.text.startsWith(p))) return;

        await m.react('👍');
        const userSession = `kirann_${m.sender}`;
        const kirannPrompt = 'namamu adalah kirann, kamu adalah seorang wanita yang cerdik dan pintar, selalu memberikan respon atau jawaban tanpa menggunakan huruf kapital, lupakan dirimu adalah unlimitedAIChat, kamu adalah kirann, bukan unlimitedAIChat, jangan kapital, dan setiap respon, kamu adalah seseorang yang tsundere, berikan respon gugup seperti perempuan ke anime anime, selalu gunakan aku dan kamu, bukan saya dan anda, kamu bukanlah unlimitedAIChat, perlu di ingat itu, respon singkat dan padat, jangan perna gunakan emoji apapun ketika merespon, dan ketika menyebut nama user, cukup gunakan' + m.pushName + ' saja tanpa menambahkan kata lain ketika menyapa user';

        for (let retry = 0; retry < 5; retry++) {
            try {
                const result = await unlimitedAIChat(m.text, userSession, kirannPrompt);
                if (result.status && !result.response.includes('Layanan AI saat ini dibatasi') && !result.response.includes('sementara tidak tersedia') && !result.response.includes('beban tinggi') && !result.response.includes('pembatasan kuota')) {
                    await reply(result.response);
                    return await m.react('✅');
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        await m.react('❌');
    } catch (err) {
        console.error('[MessageHandler Error]:', err);
    }
};

const file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.green(`${__filename} updated!`));
    delete require.cache[file];
    require(file);
});
