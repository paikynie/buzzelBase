const config = () => require('./settings/config');
process.on("uncaughtException", console.error);

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidDecode,
    Browsers,
    getDevice,
    getContentType,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    downloadContentFromMessage,
    areJidsSameUser,
    proto,
    makeCacheableSignalKeyStore,
    generateForwardMessageContent
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const pino = require('pino');
const FileType = require('file-type');
const PhoneNumber = require("awesome-phonenumber")
const FormData = require('form-data');
const readline = require("readline");
const fs = require('fs');
const chalk = require("chalk")
const path = require("path")
const crypto = require("crypto")
const {
    Boom
} = require('@hapi/boom');
const NodeCache = require("node-cache")
const ffmpeg = require("fluent-ffmpeg");
const {
    PassThrough
} = require("stream");

const {
    smsg
} = require('./library/serialize')
const {
    imageToWebp,
    videoToWebp,
    writeExifImg,
    writeExifVid,
    getBuffer
} = require('./library/_function/function')
const {
    getGroupSetting,
    setGroupSetting
} = require('./library/_function/group');

const cbMessageStore = new Map();

const question = (text) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(chalk.cyan(text), (answer) => {
            resolve(answer);
            rl.close();
        });
    });
}

const makeSqliteStore = require('./library/store');
const store = makeSqliteStore();

const clientstart = async () => {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(`./${config().session}`);
    const {
        version,
        isLatest
    } = await fetchLatestBaileysVersion();
    let groupCache = new NodeCache({
        stdTTL: 5 * 60,
        useClones: false
    })
    const sock = makeWASocket({
        printQRInTerminal: !config().status.terminal,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                pino().child({
                    level: "fatal",
                    stream: "store"
                })
            )
        },
        version,
        logger: pino({
            level: "silent"
        }),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        browser: Browsers.ubuntu("Chrome")
    });

    if (config().status.terminal && !sock.authState.creds.registered) {
        const phoneNumber = config().botNumber;
        await new Promise(r => setTimeout(r, 6000)); let code; try { code = await sock.requestPairingCode(phoneNumber, config().setPair); } catch (e) { code = 'ERROR ' + e.message; }
        console.log(chalk.green(`your pairing code: ` + chalk.bold.green(code)));
    }

    sock.ev.on('creds.update', saveCreds);
    store.bind(sock);
    global.crmstore = store;

    sock.ev.on('messages.upsert', async chatUpdate => {
        const mek = chatUpdate.messages[0];
        if (!mek.message) return;
        mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message;

        if (config().status.reactsw && mek.key && mek.key.remoteJid === 'status@broadcast') {
            let emoji = ['😘', '😭', '😂', '😹', '😍', '😋', '🙏', '😜', '😢', '😠', '🤫', '😎'];
            let sigma = emoji[Math.floor(Math.random() * emoji.length)];
            await sock.readMessages([mek.key]);
            sock.sendMessage('status@broadcast', {
                react: {
                    text: sigma,
                    key: mek.key
                }
            }, {
                statusJidList: [mek.key.participant]
            });
        }

        const rawSender = mek.key.participant || mek.key.remoteJid || '';
        const senderClean = rawSender.replace(/:\d+@/, '@').split('@')[0].replace(/\D/g, '');
        const ownerList = (config().owner || []).map(o => String(o).replace(/\D/g, ''));
        const isFromOwner = mek.key.fromMe || ownerList.includes(senderClean) || rawSender.endsWith('@lid');

        if (!config().status.public && !isFromOwner && chatUpdate.type === 'notify') return;
        if (mek.key.id.startsWith('3EB0') && mek.key.id.length === 22) return;

        const m = await smsg(sock, mek, store);
        require("./message")(sock, m, chatUpdate, store);
    });

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        }
        else return jid;
    };

    sock.ev.on('group-participants.update', async (update) => {
        const {
            id,
            author,
            participants,
            action
        } = update;
        try {
            const welcomeEnabled = getGroupSetting(id, 'welcome', false);
            const goodbyeEnabled = getGroupSetting(id, 'goodbye', false);

            if (!welcomeEnabled && !goodbyeEnabled) return;

            let participantJid = null;
            let authorJid = null;

            if (participants && participants[0]) {
                if (typeof participants[0] === 'string') {
                    participantJid = participants[0];
                }
                else if (participants[0].id) {
                    participantJid = participants[0].id;
                }
                else if (participants[0].phoneNumber) {
                    participantJid = participants[0].phoneNumber;
                }
            }

            if (author) {
                if (typeof author === 'string') {
                    authorJid = author;
                }
                else if (author.id) {
                    authorJid = author.id;
                }
                else if (author.phoneNumber) {
                    authorJid = author.phoneNumber;
                }
            }

            if (!participantJid) return;

            let participantClean = participantJid.split('@')[0];
            let authorClean = authorJid ? authorJid.split('@')[0] : '';

            let teks = '';
            let mentionedJids = [];

            if (action === 'add' && welcomeEnabled) {
                if (!authorJid) {
                    teks = `@${participantClean} join via link group`;
                    mentionedJids = [participantJid];
                }
                else if (authorJid !== participantJid) {
                    teks = `@${authorClean} added @${participantClean}`;
                    mentionedJids = [authorJid, participantJid];
                }
                else {
                    teks = `@${participantClean} joined the group`;
                    mentionedJids = [participantJid];
                }
            }
            else if (action === 'remove' && goodbyeEnabled) {
                if (authorJid === participantJid || !authorJid) {
                    teks = `@${participantClean} left the group`;
                    mentionedJids = [participantJid];
                }
                else if (authorJid !== participantJid) {
                    teks = `@${authorClean} removed @${participantClean}`;
                    mentionedJids = [authorJid, participantJid];
                }
            }

            if (teks) {
                await sock.sendMessage(id, {
                    text: teks,
                    mentions: mentionedJids
                });
            }
        }
        catch (e) {
            console.log('Group event error:', e);
        }
    });

    sock.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = sock.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = {
                id,
                name: contact.notify
            };
        }
    });

    sock.public = config().status.public;

    sock.ev.on('connection.update', (update) => {
        const {
            konek
        } = require('./library/connection/connection');
        konek({
            sock,
            update,
            clientstart,
            DisconnectReason,
            Boom
        });
    });

    sock.sendText = async (jid, text, quoted = '', options) => {
        sock.sendMessage(jid, {
            text: text,
            ...options
        }, {
            quoted
        });
    };

    sock.sendAudio = async (jid, buff, options = {}) => {
        async function downloadAudio(input) {
            if (Buffer.isBuffer(input)) return input;
            if (typeof input === 'string' && (input.startsWith('http') || input.startsWith('https'))) {
                const response = await axios.get(input, {
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                return Buffer.from(response.data);
            }
            else if (typeof input === 'string') {
                return fs.readFileSync(input);
            }
            else {
                throw new Error('Input harus Buffer, URL, atau path file');
            }
        }

        const audioBuffer = await downloadAudio(buff);
        const opusBuffer = await new Promise((resolve, reject) => {
            const inStream = new PassThrough();
            const outStream = new PassThrough();
            const chunks = [];
            inStream.end(audioBuffer);
            ffmpeg(inStream)
                .noVideo()
                .audioCodec('libopus')
                .format('ogg')
                .audioBitrate('48k')
                .audioChannels(1)
                .audioFrequency(48000)
                .outputOptions(['-vn', '-b:a 64k', '-ac 2', '-ar 48000', '-map_metadata', '-1', '-application', 'voip'])
                .on('error', reject)
                .on('end', () => resolve(Buffer.concat(chunks)))
                .pipe(outStream, {
                    end: true
                });
            outStream.on('data', c => chunks.push(c));
        });

        const waveform = await new Promise((resolve, reject) => {
            const inputStream = new PassThrough();
            inputStream.end(audioBuffer);
            const chunks = [];
            const bars = 64;
            ffmpeg(inputStream)
                .audioChannels(1)
                .audioFrequency(16000)
                .format('s16le')
                .on('error', reject)
                .on('end', () => {
                    const rawData = Buffer.concat(chunks);
                    const samples = rawData.length / 2;
                    const amplitudes = [];
                    for (let i = 0; i < samples; i++) amplitudes.push(Math.abs(rawData.readInt16LE(i * 2)) / 32768);
                    const blockSize = Math.floor(amplitudes.length / bars);
                    const avg = [];
                    for (let i = 0; i < bars; i++) {
                        const block = amplitudes.slice(i * blockSize, (i + 1) * blockSize);
                        avg.push(block.reduce((a, b) => a + b, 0) / block.length);
                    }
                    const max = Math.max(...avg);
                    const normalized = avg.map(v => Math.floor((v / max) * 100));
                    resolve(Buffer.from(new Uint8Array(normalized)).toString('base64'));
                })
                .pipe()
                .on('data', chunk => chunks.push(chunk));
        });

        return await sock.sendMessage(jid, {
            audio: opusBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: options.ptt !== undefined ? options.ptt : true,
            waveform: waveform
        }, {
            quoted: options.quoted,
            ephemeralExpiration: options.ephemeralExpiration,
            contextInfo: options.contextInfo
        });
    };

    sock.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    };

    sock.copyNForward = async (jid, message, forceForward = false, options = {}) => {
        let m = proto.WebMessageInfo.fromObject(JSON.parse(JSON.stringify(message)));
        let mtype = getContentType(m.message);
        if (options.readViewOnce) {
            if (m.message?.[mtype]?.viewOnce || JSON.stringify(m).includes('"viewOnce":true')) {
                delete m.message[mtype].viewOnce;
                m.isViewOnce = true;
            }
        }

        let content = await generateForwardMessageContent(m, forceForward);
        let ctype = getContentType(content);
        let context = {};
        if (mtype !== 'conversation') context = m.message[mtype]?.contextInfo || {};
        content[ctype].contextInfo = {
            ...context,
            ...content[ctype].contextInfo
        };

        const waMessage = await generateWAMessageFromContent(jid, content, {
            ...options,
            ...(options.contextInfo ? {
                contextInfo: {
                    ...content[ctype].contextInfo,
                    ...options.contextInfo
                }
            } : {})
        });

        await sock.relayMessage(jid, waMessage.message, {
            messageId: waMessage.key.id
        });
        return waMessage;
    };

    sock.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') :
            /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        let buffer = (options && (options.packname || options.author)) ? await writeExifImg(buff, options) : await imageToWebp(buff);
        await sock.sendMessage(jid, {
            sticker: {
                url: buffer
            },
            ...options
        }, {
            quoted
        });
        return buffer;
    };

    sock.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') :
            /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        let buffer = (options && (options.packname || options.author)) ? await writeExifVid(buff, options) : await videoToWebp(buff);
        await sock.sendMessage(jid, {
            sticker: {
                url: buffer
            },
            ...options
        }, {
            quoted
        });
        return buffer;
    };

    sock.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || "";
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        let type = await FileType.fromBuffer(buffer);
        let trueFileName = attachExtension ? filename + "." + type.ext : filename;
        await fs.writeFileSync(trueFileName, buffer);
        return trueFileName;
    };

    sock.getFile = async (PATH, returnAsFilename) => {
        let res, filename;
        const data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,` [1], 'base64') :
            /^https?:\/\//.test(PATH) ? await (res = await fetch(PATH)).buffer() : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(
                PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0);
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');
        const type = await FileType.fromBuffer(data) || {
            mime: 'application/octet-stream',
            ext: '.bin'
        };
        if (data && returnAsFilename && !filename)(filename = path.join(__dirname, './tmp/' + new Date * 1 + '.' + type.ext), await fs.promises
            .writeFile(filename, data));
        return {
            res,
            filename,
            ...type,
            data,
            deleteFile() {
                return filename && fs.promises.unlink(filename);
            }
        };
    };

    sock.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
        let type = await sock.getFile(path, true);
        let {
            res,
            data: file,
            filename: pathFile
        } = type;
        if (res && res.status !== 200 || file.length <= 65536) {
            try {
                throw {
                    json: JSON.parse(file.toString())
                };
            }
            catch (e) {
                if (e.json) throw e.json;
            }
        }

        let opt = {
            filename
        };
        if (quoted) opt.quoted = quoted;
        if (!type) options.asDocument = true;
        let mtype = '',
            mimetype = type.mime,
            convert;
        if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker';
        else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image';
        else if (/video/.test(type.mime)) mtype = 'video';
        else if (/audio/.test(type.mime))(convert = await (ptt ? toPTT : toAudio)(file, type.ext), file = convert.data, pathFile = convert
            .filename, mtype = 'audio', mimetype = 'audio/ogg; codecs=opus');
        else mtype = 'document';
        if (options.asDocument) mtype = 'document';

        let message = {
            ...options,
            caption,
            ptt,
            [mtype]: {
                url: pathFile
            },
            mimetype
        };
        let m;
        try {
            m = await sock.sendMessage(jid, message, {
                ...opt,
                ...options
            });
        }
        catch (e) {
            console.error(e);
            m = null;
        }
        finally {
            if (!m) m = await sock.sendMessage(jid, {
                ...message,
                [mtype]: file
            }, {
                ...opt,
                ...options
            });
            return m;
        }
    };

    sock.reply = async (jid, teks = "", quoted = null) => {
        await sock.sendMessage(jid, {
            text: teks
        }, {
            quoted
        });
    };

    sock.getmsg = sock.getMsg = async (jid, limit = 5) => {
        const rows = store?.getmsg ? store.getmsg(jid, limit) : [];
        return await Promise.all(rows.map(async (r) => {
            const raw = typeof r.getMessageObject === 'function' ? r.getMessageObject() : null;
            if (raw) {
                const serialized = await smsg(sock, raw, store);
                return serialized || r;
            }
            return r;
        }));
    };

    sock.getName = async (jid = "", withoutContact = false) => {
        jid = sock.decodeJid(jid);
        withoutContact = sock.withoutContact || withoutContact;
        let v;
        if (jid.endsWith("@g.us")) {
            return sock.groupMetadata(jid).then((metadata) => metadata || store?.fetchGroupMetadata(jid, sock.groupMetadata)).then((metadata) =>
                metadata || {}).then((metadata) => metadata.name || metadata.subject || PhoneNumber("+" + Number(parseInt(jid))).getNumber(
                "international"));
        }
        if (jid.endsWith("@newsletter")) {
            return sock.newsletterMetadata("jid", jid).then((metadata) => metadata || {}).then((metadata) => metadata.name || metadata
                .subject || PhoneNumber("+" + Number(parseInt(jid))).getNumber("international"));
        }
        v = jid === "0@s.whatsapp.net" ? {
            jid: jid,
            vname: "WhatsApp"
        } : areJidsSameUser(jid, sock.user.id) ? sock.user : (store?.contacts[jid] || {});
        return (withoutContact ? "" : v.name) || v.subject || v.vname || v.notify || v.verifiedName || PhoneNumber("+" + jid.replace(
            "@s.whatsapp.net", "")).getNumber("international");
    };

}

clientstart();

const ignoredErrors = [
    'Socket connection timeout',
    'EKEYTYPE',
    'item-not-found',
    'rate-overlimit',
    'Connection Closed',
    'Timed Out',
    'Value not found'
];

let file = require.resolve(__filename);
require('fs').watchFile(file, () => {
    delete require.cache[file];
    require(file);
});

process.on('unhandledRejection', reason => {
    if (ignoredErrors.some(e => String(reason).includes(e))) return;
    console.log('Unhandled Rejection:', reason);
});

const originalConsoleError = console.error;
console.error = function(msg, ...args) {
    if (typeof msg === 'string' && ignoredErrors.some(e => msg.includes(e))) return;
    originalConsoleError.apply(console, [msg, ...args]);
};

const originalStderrWrite = process.stderr.write;
process.stderr.write = function(msg, encoding, fd) {
    if (typeof msg === 'string' && ignoredErrors.some(e => msg.includes(e))) return;
    originalStderrWrite.apply(process.stderr, arguments);
};
