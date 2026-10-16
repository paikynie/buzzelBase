const fs = require('fs');
const sharp = require('sharp');
const { generateWAMessageFromContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

/**
 * Sends a rich link-preview card message.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {object} m
 * @param {string} text
 * @param {object} config
 */
async function sendCard(sock, m, text, config) {
    const mono = '```';
    const bodyText = `${mono}${text}${mono}`;

    const media = await prepareWAMessageMedia({
        image: { url: config.image.thumbnail }
    }, {
        upload: sock.waUploadToServer,
        mediaTypeOverride: 'thumbnail-link'
    });
    const img = media.imageMessage;

    const fav = await prepareWAMessageMedia({
        image: { url: config.image.favicon }
    }, {
        upload: sock.waUploadToServer,
        mediaTypeOverride: 'thumbnail-link'
    });
    const favicon = fav.imageMessage;

    const content = {
        extendedTextMessage: {
            text: `https://wa.me/6281351692548\n${bodyText}`,
            matchedText: 'https://wa.me/6281351692548',
            description: 'Simple WaBot',
            title: 'kyuurzy',
            previewType: 6,
            inviteLinkGroupTypeV2: 0,
            jpegThumbnail: img.jpegThumbnail,
            thumbnailDirectPath: img.directPath,
            thumbnailSha256: img.fileSha256,
            thumbnailEncSha256: img.fileEncSha256,
            mediaKey: img.mediaKey,
            mediaKeyTimestamp: img.mediaKeyTimestamp,
            thumbnailHeight: 1024,
            thumbnailWidth: 512,
            type: 'thumbnail',
            contextInfo: {
                mentionedJid: [m.sender, '0@s.whatsapp.net']
            },
            faviconMMSMetadata: {
                thumbnailDirectPath: favicon.directPath,
                thumbnailSha256: favicon.fileSha256,
                thumbnailEncSha256: favicon.fileEncSha256,
                mediaKey: favicon.mediaKey,
                mediaKeyTimestamp: favicon.mediaKeyTimestamp,
                thumbnailHeight: 1440,
                thumbnailWidth: 1440
            }
        }
    };

    const msg = generateWAMessageFromContent(m.chat, content, {
        quoted: m,
        userJid: sock.user.id
    });
    await sock.relayMessage(m.chat, msg.message, {
        messageId: msg.key.id
    });
}

/**
 * Menu plugin for general and categorized command navigation.
 */
module.exports = {
    name: 'menu',
    command: [
        'menu',
        'listmenu',
        'list',
        'menu_download',
        'menu_ai',
        'menu_group',
        'menu_store',
        'menu_owner',
        'menu_stalk',
        'menu_tools'
    ],
    tags: ['main'],
    help: ['menu'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, prefix, config }) {
        if (command === 'menu_download') {
            return sendCard(sock, m, `DOWNLOAD MENU\n\n- ${prefix}capcut\n- ${prefix}play\n- ${prefix}tiktok\n- ${prefix}igdl`, config);
        }

        if (command === 'menu_ai') {
            return sendCard(sock, m, `AI MENU\n\n- ${prefix}text2anime\n- ${prefix}blackbox\n- ${prefix}bgapi\n- ${prefix}deepai\n- ${prefix}greenpink\n- ${prefix}hero\n- ${prefix}perplexity\n- ${prefix}sts\n- ${prefix}ai\n- ${prefix}kirann\n- ${prefix}autokirann`, config);
        }

        if (command === 'menu_group') {
            return sendCard(sock, m, `GROUP MENU\n\n- ${prefix}hidetag\n- ${prefix}tagall\n- ${prefix}welcome\n- ${prefix}goodbye\n- ${prefix}am send/verif`, config);
        }

        if (command === 'menu_store') {
            return sendCard(sock, m, `STORE MENU\n\n- ${prefix}addcatalog\n- ${prefix}delcatalog\n- ${prefix}addstock\n- ${prefix}listcatalog\n- ${prefix}buy\n- ${prefix}gopay`, config);
        }

        if (command === 'menu_owner') {
            return sendCard(sock, m, `OWNER MENU\n\n- ${prefix}eval\n- ${prefix}run\n- ${prefix}crm\n- ${prefix}addprefix\n- ${prefix}delprefix\n- ${prefix}listprefix\n- ${prefix}noprefix\n- ${prefix}backup\n- ${prefix}upswgc\n- ${prefix}gopay\n- ${prefix}exec`, config);
        }

        if (command === 'menu_stalk') {
            return sendCard(sock, m, `STALK MENU\n\n- ${prefix}stalk-ff\n- ${prefix}stalk-mlbb\n- ${prefix}stalk-ig`, config);
        }

        if (command === 'menu_tools') {
            return sendCard(sock, m, `TOOLS MENU\n\n- ${prefix}get\n- ${prefix}cat\n- ${prefix}getmsg\n- ${prefix}s\n- ${prefix}hd\n- ${prefix}pinterest`, config);
        }

        // Main Menu
        const res = await fetch(config.image.thumbnail);
        const imageBuffer = Buffer.from(await res.arrayBuffer());
        const thumbnailBuffer = await sharp(imageBuffer)
            .resize(300, 300)
            .jpeg({ quality: 80 })
            .toBuffer();

        const msg = generateWAMessageFromContent(m.chat, {
            buttonsMessage: {
                locationMessage: {
                    degreesLatitude: 0,
                    degreesLongitude: 0,
                    name: 'kyuurzy wa-bot',
                    jpegThumbnail: thumbnailBuffer
                },
                contentText: `Hai @${m.sender.replace(/@.+/g, '')}`,
                footerText: 'Thanks @0',
                headerType: 6,
                contextInfo: {
                    mentionedJid: [m.sender, '0@s.whatsapp.net']
                },
                buttons: [
                    {
                        buttonId: 'menu1',
                        buttonText: { displayText: '#' },
                        type: 1,
                        nativeFlowInfo: {
                            name: 'single_select',
                            paramsJson: JSON.stringify({
                                title: 'MENU 1',
                                sections: [{
                                    title: 'Pilih Menu',
                                    rows: [
                                        { title: 'Menu Download', id: `${prefix}menu_download` },
                                        { title: 'Menu AI', id: `${prefix}menu_ai` },
                                        { title: 'Menu Group', id: `${prefix}menu_group` },
                                        { title: 'Menu Store', id: `${prefix}menu_store` }
                                    ]
                                }]
                            })
                        }
                    },
                    {
                        buttonId: 'menu2',
                        buttonText: { displayText: '#' },
                        type: 1,
                        nativeFlowInfo: {
                            name: 'single_select',
                            paramsJson: JSON.stringify({
                                title: 'MENU 2',
                                sections: [{
                                    title: 'Pilih Menu',
                                    rows: [
                                        { title: 'Menu Owner', id: `${prefix}menu_owner` },
                                        { title: 'Menu Stalk', id: `${prefix}menu_stalk` },
                                        { title: 'Menu Tools', id: `${prefix}menu_tools` }
                                    ]
                                }]
                            })
                        }
                    }
                ]
            }
        }, {
            userJid: sock.user.id,
            quoted: m
        });

        await sock.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [{
                tag: 'biz',
                attrs: {
                    actual_actors: '2',
                    host_storage: '2',
                    privacy_mode_ts: '1702827093'
                },
                content: [{
                    tag: 'engagement',
                    attrs: {
                        customer_service_state: 'open',
                        conversation_state: 'open'
                    }
                }, {
                    tag: 'interactive',
                    attrs: {
                        type: 'native_flow',
                        v: '1'
                    },
                    content: [{
                        tag: 'native_flow',
                        attrs: {
                            v: '9',
                            name: 'mixed'
                        }
                    }]
                }]
            }]
        });

        if (fs.existsSync('./library/audio.mp3') && typeof sock.sendAudio === 'function') {
            sock.sendAudio(m.chat, fs.readFileSync('./library/audio.mp3'), {
                ptt: true,
                quoted: m
            });
        }
    }
};
