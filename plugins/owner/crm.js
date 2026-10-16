/**
 * @fileoverview CRM (Create Relay Message) plugin for inspecting and generating WhatsApp relay payloads.
 */

const crypto = require('crypto');
const { proto } = require('@whiskeysockets/baileys');

const ignoredTags = new Set([
    'device-identity', 'quality_control', 'enc', 'hsm',
    'verified_name', 'multicast', 'reporting', 'unavailable', 'rcat'
]);

const ignoredAttributes = new Set([
    'id', 'from', 'to', 'participant', 'recipient', 'type',
    'sts', 'verified_level', 'notify', 'addressing_mode',
    'verified_name', 'participant_pn', 't', 'count'
]);

const SECRET_CONTEXT = {
    EVENT_EDIT: 'Event Edit',
    MESSAGE_EDIT: 'Message Edit',
    POLL_EDIT: 'Poll Edit',
    POLL_ADD_OPTION: 'Poll Edit'
};

module.exports = {
    name: 'crm',
    command: ['crm', 'crm2', 'insp', 'adn', 'relay'],
    tags: ['owner', 'tools'],
    help: [
        'crm [reply|#rowid]',
        'crm2 [reply]',
        'insp [reply]',
        'adn [reply]',
        'relay [reply]'
    ],
    isOwner: true,

    /**
     * Executes the CRM command suite.
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, args, store }) {
        const crmstore = store || global.crmstore;
        if (!crmstore || !crmstore.db) {
            return m.reply('⚠️ Database store belum tersedia.');
        }

        const rawText = String(text || '').trim();
        const argList = rawText.split(/\s+/).filter(Boolean);

        const rowMatch = argList[0]?.match(/^#(\d+)$/);
        const rowid = rowMatch ? Number(rowMatch[1]) : null;

        let chatId;
        let targetId;
        let msgSource;
        let rmsg;

        if (rowid !== null) {
            const row = crmstore.db.prepare(`
                SELECT rowid, id, remoteJid AS chat, sender, messageTimestamp AS timestamp, raw
                FROM messages
                WHERE rowid = ?
                LIMIT 1
            `).get(rowid);

            if (!row) {
                return m.reply(`Message dengan rowid #${rowid} tidak ditemukan.`);
            }

            try {
                const parsed = JSON.parse(row.raw);
                rmsg = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(parsed), {
                    enums: Number,
                    longs: Number,
                    bytes: String,
                    defaults: false
                });
            } catch (e) {
                return m.reply(`Gagal decode rowid #${rowid}:\n${e.message}`);
            }

            chatId = row.chat;
            targetId = row.id;
            msgSource = `rowid:${rowid}`;
        } else {
            if (!m.quoted) {
                const usage = `📌 *.${command}* butuh pesan yang di-reply.\n\n` +
                    `*Command:*\n` +
                    `• .crm → Generate file relay siap pakai dari pesan\n` +
                    `• .crm #rowid → Generate file relay langsung dari SQLite\n` +
                    `• .crm2 → Kirim raw + relay code via dokumen detail\n` +
                    `• .adn → Ambil AdditionalNodes dari pesan\n` +
                    `• .insp → Ambil raw payload (JSON) pesan\n` +
                    `• .relay → Langsung relay ulang pesan beserta child-nya\n\n` +
                    `*Flag opsional:*\n` +
                    `• -raw → Export raw JSON pesan\n` +
                    `• -message → Export bagian message saja\n` +
                    `• -relay → Export kode relay\n` +
                    `• -file → Kirim hasil export sebagai dokumen\n` +
                    `• -snip → Tampilkan hasil sebagai code snippet\n` +
                    `• -nofilter → Jangan filter AdditionalNodes\n` +
                    `• -nochild → Matikan pencarian child\n` +
                    `• -noproto → Skip deep search protocolMessage/secretEncryptedMessage\n\n` +
                    `Contoh:\n.crm\n.crm #4825\n.crm #4825 -snip\n.insp -noproto -raw -file\n.relay -nochild`;
                return m.reply(usage);
            }

            chatId = m.quoted.chat || m.chat;
            targetId = m.quoted.id;

            let loadedFromStore = null;
            try {
                loadedFromStore = await crmstore.loadMessage(targetId, chatId);
            } catch {}

            let quotedObj = null;
            if (typeof m.getQuotedObj === 'function') {
                try {
                    quotedObj = await m.getQuotedObj();
                } catch {}
            }

            const sources = [
                { type: 'crmstore', data: loadedFromStore },
                { type: 'quotedObj', data: quotedObj },
                { type: 'fakeObj', data: m.quoted?.fakeObj }
            ];

            const source = sources.find((v) => v.data?.message || v.data?.key);
            msgSource = source?.type;
            rmsg = source?.data;
        }

        let msg;
        if (rmsg) {
            msg = await normalizeMessage(rmsg, crmstore, chatId);
        }

        if (!msg?.message) {
            return m.reply(`⛓️‍💥 Message tidak valid (${typeof msg?.message})`);
        }

        const messageId = msg.key?.id || targetId;
        const rawNode = loadBestNode(crmstore, messageId, chatId, msg);
        const nodeAttrs = getNodeAttributes(rawNode);
        const nodeContent = getNodeContent(rawNode);

        const type = Object.keys(msg.message).find((v) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(v)) || 'unknown';
        const additionalNodes = filterAdditionalNodes(nodeContent);
        const relayOptions = getRelayOptions(rawNode);
        const parentSender = getSenderIdentity(msg.key);

        const noChild = rawText.includes('-nochild');
        const noProto = rawText.includes('-noproto');
        const stats = { fails: 0 };

        const childTree = noChild ? [] : await buildChildTree(crmstore, chatId, messageId, parentSender, 50, 0, 5, new Set(), !noProto, stats);

        if (command === 'relay') {
            const newParentId = await sock.relayMessage(m.chat, structuredClone(msg.message), relayOptions);
            await relayChildTree(sock, m.chat, childTree, newParentId);
            return m.reply(`✅ Relay berhasil dikirim.\nID: ${newParentId}`);
        }

        const rawPayload = {
            message: msg,
            node: rawNode,
            additionalAttributes: nodeAttrs,
            additionalNodes
        };

        const raw = stringify(rawPayload);
        const messageJson = stringify(msg.message);
        const keyJson = stringify(msg.key);
        const optionsSnippet = stringifySnippet(relayOptions);
        const snippetMessage = stringifySnippet(msg.message);
        const relayCode = buildRelayScript(snippetMessage, optionsSnippet, childTree);

        const files = {
            raw,
            message: messageJson,
            relay: relayCode
        };

        const exportType = ['raw', 'message', 'relay'].find((v) => rawText.includes(`-${v}`));
        if (exportType) {
            if (rawText.includes('-file')) {
                return sock.sendMessage(m.chat, {
                    document: Buffer.from(files[exportType]),
                    fileName: exportType === 'relay' ? `${type}.js` : `${exportType}.json`,
                    mimetype: exportType === 'relay' ? 'application/javascript' : 'application/json'
                }, { quoted: m });
            }
            return m.reply(files[exportType]);
        }

        const isSnip = rawText.includes('-snip');
        const formatChat = (c) => (!c ? '-' : isSnip ? `${c.slice(0, 7)}.....${c.split('@')[1] || ''}` : c);
        const formatId = (id) => (!id ? '-' : isSnip ? `${id.slice(0, 7)}.....` : id);

        const childrenCount = countTree(childTree);
        const childrenLine = stats.fails ? `${childrenCount} (${stats.fails} fail)` : `${childrenCount}`;
        const sender = msg.key?.participant || msg.key?.participantAlt || msg.key?.remoteJid || m.quoted?.sender || '-';
        const nodeChat = rawNode?.attrs?.from || rawNode?.attrs?.to || rawNode?.attrs?.recipient || '-';

        const metadata = `• Type     : ${type}\n` +
            `• Source   : ${msgSource || '-'}\n` +
            `• Chat     : ${formatChat(chatId)}\n` +
            `• Node Chat: ${formatChat(nodeChat)}\n` +
            `• ID       : ${formatId(messageId)}\n` +
            `• Node ID  : ${formatId(rawNode?.attrs?.id || '-')}\n` +
            `• Sender   : ${sender.split('@')[0]}\n` +
            `• Node Tag : ${rawNode?.tag || '-'}\n` +
            `• Attrs    : ${Object.keys(nodeAttrs).length}\n` +
            `• Children : ${childrenLine}`;

        if (command === 'insp') {
            const inspPayload = attachChildren(rawPayload, childTree);
            const imsg = stringify(inspPayload);

            if (isSnip) {
                if (imsg.length > 20000) {
                    return m.reply('⚠️ Payload terlalu besar untuk snip teks. Mengirim via dokumen.');
                }
                return m.reply(`# 📥 Raw Snippet\n${metadata}\n\n\`\`\`javascript\n${imsg}\n\`\`\``);
            }

            return sock.sendMessage(m.chat, {
                document: Buffer.from(imsg),
                fileName: `${type}.json`,
                mimetype: 'application/json',
                caption: metadata
            }, { quoted: m });
        }

        const adn = rawText.includes('-nofilter') ? additionalNodes : filterAdditionalNodes(additionalNodes);

        if (command === 'adn' && !adn.length) {
            return m.reply('No AdditionalNodes captured 📷');
        }

        if (command === 'crm') {
            if (isSnip) {
                if (relayCode.length > 20000) {
                    return m.reply('⚠️ Payload terlalu besar untuk snip teks. Mengirim via dokumen.');
                }
                return m.reply(`# ⚡ Relay Snippet\n${metadata}\n\n\`\`\`javascript\n${relayCode}\n\`\`\``);
            }

            return sock.sendMessage(m.chat, {
                document: Buffer.from(relayCode),
                fileName: `${type}.js`,
                mimetype: 'application/javascript',
                caption: metadata
            }, { quoted: m });
        }

        if (command === 'adn') {
            if (isSnip) {
                return m.reply(`# 📸 AdditionalNode Captured\n${metadata}\n\n\`\`\`javascript\n${stringifySnippet(adn)}\n\`\`\``);
            }

            return sock.sendMessage(m.chat, {
                document: Buffer.from(stringify(adn)),
                fileName: 'additionalNodes.json',
                mimetype: 'application/json',
                caption: metadata
            }, { quoted: m });
        }

        if (command === 'crm2') {
            const detailText = `⚡ *CRM2 - PAYLOAD DETAILS*\n\n${metadata}\n\n` +
                `*Options:*\n\`\`\`javascript\n${optionsSnippet}\n\`\`\`\n\n` +
                `*Key:*\n\`\`\`json\n${keyJson}\n\`\`\``;

            return sock.sendMessage(m.chat, {
                document: Buffer.from(relayCode),
                mimetype: 'application/javascript',
                fileName: `${type}.js`,
                caption: detailText
            }, { quoted: m });
        }
    }
};

function loadBestNode(crmstore, messageId, chatId, msg) {
    if (!crmstore || !messageId) return null;

    let node = null;
    try {
        node = crmstore.loadNode(messageId, chatId);
    } catch {}

    if (node) return node;

    const altChats = [
        chatId, msg?.key?.remoteJid, msg?.key?.remoteJidAlt,
        msg?.key?.participant, msg?.key?.participantAlt,
        msg?.key?.senderPn, msg?.key?.senderLid
    ].filter(Boolean);

    for (const jid of [...new Set(altChats)]) {
        if (jid === chatId) continue;
        try {
            node = crmstore.loadNode(messageId, jid);
        } catch {}
        if (node) return node;
    }

    try {
        const raw = crmstore.loadNode(messageId);
        if (raw) return raw;
    } catch {}

    return null;
}

function getNodeAttributes(node) {
    if (!node?.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs)) {
        return {};
    }
    const attrs = { ...node.attrs };
    for (const key of ignoredAttributes) {
        delete attrs[key];
    }
    return attrs;
}

function getNodeContent(node) {
    if (!node || !Array.isArray(node.content)) return [];
    return node.content;
}

function normalizeMessage(rmsg, crmstore, chat) {
    const normalized = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(rmsg), {
        enums: Number,
        longs: Number,
        bytes: String,
        defaults: false
    });
    return decryptSecretEnvelope(normalized, crmstore, chat);
}

async function decryptSecretEnvelope(msg, crmstore, chat) {
    const secret = msg?.message?.secretEncryptedMessage;
    if (!secret) return msg;

    const type = secretEncTypeName(secret.secretEncType);
    if (!['MESSAGE_EDIT', 'EVENT_EDIT', 'POLL_EDIT', 'POLL_ADD_OPTION'].includes(type)) {
        return msg;
    }

    const targetKey = secret.targetMessageKey;
    if (!targetKey?.id) return msg;

    const target = loadTargetSecret(crmstore, chat, targetKey);
    if (!target) return msg;

    const decrypted = decryptSecretMessage(secret, target, type);
    if (!decrypted) return msg;

    return {
        ...msg,
        message: decrypted
    };
}

function getSenderIdentity(key) {
    if (!key) return { me: false, jids: new Set() };
    if (key.fromMe) return { me: true, jids: new Set() };

    const jids = new Set([key.participant, key.participantAlt].filter(Boolean));
    if (!jids.size && key.remoteJid) jids.add(key.remoteJid);

    return { me: false, jids };
}

function collectDeepKeys(node, depth = 0, maxDepth = 12, out = []) {
    if (!node || typeof node !== 'object' || depth > maxDepth) return out;
    if (node.protocolMessage?.key) out.push(node.protocolMessage.key);
    if (node.secretEncryptedMessage?.targetMessageKey) out.push(node.secretEncryptedMessage.targetMessageKey);

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            collectDeepKeys(value, depth + 1, maxDepth, out);
        }
    }
    return out;
}

function collectSecretMessages(node, depth = 0, maxDepth = 12, out = []) {
    if (!node || typeof node !== 'object' || depth > maxDepth) return out;
    if (node.secretEncryptedMessage) out.push(node.secretEncryptedMessage);

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            collectSecretMessages(value, depth + 1, maxDepth, out);
        }
    }
    return out;
}

function findMessageSecret(node, depth = 0, maxDepth = 12) {
    if (!node || typeof node !== 'object' || depth > maxDepth) return null;
    if (node.messageContextInfo?.messageSecret) return node.messageContextInfo.messageSecret;

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            const found = findMessageSecret(value, depth + 1, maxDepth);
            if (found) return found;
        }
    }
    return null;
}

function loadTargetSecret(crmstore, chat, targetKey) {
    try {
        let row = null;
        if (crmstore.db) {
            row = crmstore.db.prepare(`
                SELECT raw FROM messages WHERE id = ? LIMIT 1
            `).get(targetKey.id);
        }
        if (!row?.raw) return null;

        const parsed = JSON.parse(row.raw);
        const normalized = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(parsed), {
            enums: Number,
            longs: Number,
            bytes: String,
            defaults: false
        });

        const secretB64 = findMessageSecret(normalized.message);
        if (!secretB64) return null;

        const key = normalized.key || {};
        const senderJid = key.participant || targetKey.participant || key.remoteJid || targetKey.remoteJid;
        if (!senderJid) return null;

        return {
            messageSecret: Buffer.from(secretB64, 'base64'),
            senderJid
        };
    } catch {
        return null;
    }
}

function secretEncTypeName(value) {
    if (typeof value === 'string') return value;
    try {
        return proto.Message.SecretEncryptedMessage.SecretEncType[value] ?? value;
    } catch {
        return value;
    }
}

function decryptSecretMessage(secretMsg, target, type) {
    try {
        const targetId = secretMsg?.targetMessageKey?.id;
        if (!targetId || !secretMsg?.encPayload || !secretMsg?.encIv || !target?.messageSecret) {
            return null;
        }

        const context = SECRET_CONTEXT[type];
        if (!context) return null;

        const messageSecret = target.messageSecret;
        if (messageSecret.length !== 32) return null;

        const senderJid = target.senderJid;
        const info = Buffer.concat([
            Buffer.from(targetId, 'utf8'),
            Buffer.from(senderJid, 'utf8'),
            Buffer.from(senderJid, 'utf8'),
            Buffer.from(context, 'utf8')
        ]);

        const key = crypto.hkdfSync('sha256', messageSecret, Buffer.alloc(0), info, 32);
        const encPayload = Buffer.from(secretMsg.encPayload, 'base64');
        const encIv = Buffer.from(secretMsg.encIv, 'base64');

        if (encIv.length !== 12 || encPayload.length < 16) return null;

        const authTag = encPayload.subarray(-16);
        const ciphertext = encPayload.subarray(0, -16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), encIv);
        decipher.setAuthTag(authTag);

        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const decoded = proto.Message.decode(plaintext);

        return proto.Message.toObject(decoded, {
            enums: Number,
            longs: Number,
            bytes: String,
            defaults: false
        });
    } catch {
        return null;
    }
}

async function decryptChildMessage(crmstore, chat, msgObj) {
    const secrets = collectSecretMessages(msgObj);
    if (!secrets.length) return { message: msgObj, fails: 0 };

    let current = msgObj;
    let fails = 0;

    for (const secretMsg of secrets) {
        const targetKey = secretMsg?.targetMessageKey;
        if (!targetKey?.id) {
            fails++;
            continue;
        }

        const target = loadTargetSecret(crmstore, chat, targetKey);
        if (!target) {
            fails++;
            continue;
        }

        const type = secretEncTypeName(secretMsg.secretEncType);
        const decrypted = decryptSecretMessage(secretMsg, target, type);
        if (!decrypted) {
            fails++;
            continue;
        }

        current = replaceSecretEnvelope(current, secretMsg, decrypted);
    }

    return { message: current, fails };
}

function replaceSecretEnvelope(node, targetSecret, decrypted) {
    if (!node || typeof node !== 'object') return node;
    if (node.secretEncryptedMessage === targetSecret) return decrypted;

    if (node.secretEncryptedMessage && sameSecretEnvelope(node.secretEncryptedMessage, targetSecret)) {
        return decrypted;
    }

    if (Array.isArray(node)) {
        return node.map((val) => replaceSecretEnvelope(val, targetSecret, decrypted));
    }

    const out = { ...node };
    for (const [key, val] of Object.entries(out)) {
        if (val && typeof val === 'object') {
            out[key] = replaceSecretEnvelope(val, targetSecret, decrypted);
        }
    }
    return out;
}

function sameSecretEnvelope(a, b) {
    return a?.targetMessageKey?.id === b?.targetMessageKey?.id &&
        a?.encPayload === b?.encPayload &&
        a?.encIv === b?.encIv &&
        a?.secretEncType === b?.secretEncType;
}

function getParentKey(key, chat) {
    if (!key?.id) return null;
    return {
        id: key.id,
        remoteJid: key.remoteJid || chat,
        fromMe: !!key.fromMe,
        participant: key.participant,
        participantAlt: key.participantAlt
    };
}

function matchesParentKey(keyObj, parentKey, chat) {
    if (!keyObj || !parentKey || !keyObj.id || keyObj.id !== parentKey.id) return false;
    const keyRemoteJid = keyObj.remoteJid || keyObj.remoteJidAlt;
    const parentRemoteJid = parentKey.remoteJid || chat;
    if (keyRemoteJid && parentRemoteJid && keyRemoteJid !== parentRemoteJid) return false;
    return true;
}

async function findDirectChildren(crmstore, chat, parentId, parentSender, radius = 50, useProto = true) {
    const base = crmstore.db.prepare(`
        SELECT messageTimestamp AS timestamp, raw
        FROM messages
        WHERE id = ? AND remoteJid = ?
        LIMIT 1
    `).get(parentId, chat);

    if (!base) return [];

    let parentMessage;
    try {
        const parsed = JSON.parse(base.raw);
        parentMessage = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(parsed), {
            enums: Number,
            longs: Number,
            bytes: String,
            defaults: false
        });
    } catch {
        return [];
    }

    const parentKey = getParentKey(parentMessage.key, chat);
    if (!parentKey) return [];

    const older = crmstore.db.prepare(`
        SELECT id, raw
        FROM messages
        WHERE remoteJid = ? AND messageTimestamp <= ?
        ORDER BY messageTimestamp DESC
        LIMIT ?
    `).all(chat, base.timestamp, radius);

    const newer = crmstore.db.prepare(`
        SELECT id, raw
        FROM messages
        WHERE remoteJid = ? AND messageTimestamp > ?
        ORDER BY messageTimestamp ASC
        LIMIT ?
    `).all(chat, base.timestamp, radius);

    const children = [];
    for (const row of [...older, ...newer]) {
        if (row.id === parentId) continue;

        let decoded;
        try {
            const parsed = JSON.parse(row.raw);
            decoded = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(parsed), {
                enums: Number,
                longs: Number,
                bytes: String,
                defaults: false
            });
        } catch {
            continue;
        }

        const assocKey = decoded?.message?.messageContextInfo?.messageAssociation?.parentMessageKey;
        const matchedAssoc = matchesParentKey(assocKey, parentKey, chat);
        const matchedDeep = useProto ? collectDeepKeys(decoded?.message).some((key) => matchesParentKey(key, parentKey, chat)) : false;

        if (!matchedAssoc && !matchedDeep) continue;
        children.push(decoded);
    }

    return children;
}

async function buildChildTree(crmstore, chat, parentId, parentSender, radius = 50, depth = 0, maxDepth = 5, visited = new Set(), useProto = true, stats = { fails: 0 }) {
    if (depth >= maxDepth) return [];

    const visitKey = `${chat}:${parentId}:${serializeSender(parentSender)}`;
    if (visited.has(visitKey)) return [];
    visited.add(visitKey);

    const rawChildren = await findDirectChildren(crmstore, chat, parentId, parentSender, radius, useProto);
    const result = [];

    for (const rawChild of rawChildren) {
        const normalized = await normalizeMessage(rawChild, crmstore, chat);
        const decrypted = await decryptChildMessage(crmstore, chat, normalized.message);

        stats.fails += decrypted.fails;
        const finalRaw = { ...normalized, message: decrypted.message };
        const msg = unwrapAssociatedChild(finalRaw);

        if (!msg?.key?.id || !msg?.message) continue;

        const childId = msg.key.id;
        const childSender = getSenderIdentity(msg.key);
        const childNode = loadBestNode(crmstore, childId, chat, msg);
        const relayOptions = getRelayOptions(childNode);
        const children = await buildChildTree(crmstore, chat, childId, childSender, radius, depth + 1, maxDepth, visited, useProto, stats);

        result.push({
            raw: finalRaw,
            node: childNode,
            msg,
            relayOptions,
            children
        });
    }

    return result;
}

function serializeSender(sender) {
    if (!sender) return '';
    if (sender.me) return 'me';
    return [...sender.jids].sort().join(',');
}

async function relayChildTree(sock, chat, nodes, parentId) {
    for (const node of nodes) {
        const message = structuredClone(node.msg.message);
        const assoc = message?.messageContextInfo?.messageAssociation;

        if (assoc?.parentMessageKey) {
            assoc.parentMessageKey.id = parentId;
            assoc.parentMessageKey.remoteJid = chat;
            assoc.parentMessageKey.fromMe = true;
        }

        const protocolKeys = collectProtocolKeys(message);
        for (const key of protocolKeys) {
            key.id = parentId;
            key.remoteJid = chat;
            key.fromMe = true;
        }

        const options = { ...node.relayOptions };
        const newChildId = await sock.relayMessage(chat, message, options);
        await relayChildTree(sock, chat, node.children, newChildId);
    }
}

function collectProtocolKeys(node, depth = 0, maxDepth = 12, out = []) {
    if (!node || typeof node !== 'object' || depth > maxDepth) return out;
    if (node.protocolMessage?.key) out.push(node.protocolMessage.key);

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            collectProtocolKeys(value, depth + 1, maxDepth, out);
        }
    }
    return out;
}

function filterAdditionalNodes(nodes) {
    return (nodes || []).filter((v) => !ignoredTags.has(v?.tag));
}

function getRelayOptions(node = null) {
    const additionalAttributes = getNodeAttributes(node);
    const additionalNodes = filterAdditionalNodes(getNodeContent(node));
    const options = {};

    if (Object.keys(additionalAttributes).length) {
        options.additionalAttributes = additionalAttributes;
    }
    if (additionalNodes.length) {
        options.additionalNodes = additionalNodes;
    }

    return options;
}

function countTree(nodes) {
    return nodes.reduce((sum, node) => sum + 1 + countTree(node.children), 0);
}

function attachChildren(base, tree) {
    if (!tree.length) return base;
    return {
        ...base,
        __children: tree.map((node) => {
            const child = attachChildren(node.raw, node.children);
            if (node.node) {
                return { ...child, __node: node.node };
            }
            return child;
        })
    };
}

function unwrapAssociatedChild(msg) {
    const contextInfo = msg?.message?.messageContextInfo;
    const inner = msg?.message?.associatedChildMessage?.message;
    if (!inner) return msg;

    return {
        ...msg,
        message: {
            ...inner,
            messageContextInfo: contextInfo
        }
    };
}

function findBlockEnd(str, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < str.length; i++) {
        if (str[i] === '{') depth++;
        if (str[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function injectKeyBlock(snippet, marker, parentIdExpr) {
    const start = snippet.indexOf(marker);
    if (start === -1) return snippet;

    const braceIndex = start + marker.length - 1;
    const end = findBlockEnd(snippet, braceIndex);
    if (end === -1) return snippet;

    const indentMatch = snippet.slice(0, start).match(/([ \t]*)$/);
    const indent = indentMatch ? indentMatch[1] : '';

    const replacement = `${marker.slice(0, -1)}{\n${indent}  remoteJid: m.chat,\n${indent}  fromMe: true,\n${indent}  id: ${parentIdExpr}\n${indent}}`;
    return snippet.slice(0, start) + replacement + snippet.slice(end + 1);
}

function injectParentKey(childSnippet, parentIdExpr = 'newParentId') {
    return injectKeyBlock(childSnippet, 'parentMessageKey: {', parentIdExpr);
}

function injectTargetKey(childSnippet, parentIdExpr = 'newParentId') {
    return injectKeyBlock(childSnippet, 'targetMessageKey: {', parentIdExpr);
}

function injectProtocolKey(childSnippet, parentIdExpr = 'newParentId') {
    const marker = 'protocolMessage: {';
    const start = childSnippet.indexOf(marker);
    if (start === -1) return childSnippet;

    const braceIndex = start + marker.length - 1;
    const blockEnd = findBlockEnd(childSnippet, braceIndex);
    if (blockEnd === -1) return childSnippet;

    const before = childSnippet.slice(0, start);
    const block = childSnippet.slice(start, blockEnd + 1);
    const after = childSnippet.slice(blockEnd + 1);
    const patchedBlock = injectKeyBlock(block, 'key: {', parentIdExpr);

    return before + patchedBlock + after;
}

function buildChildScript(nodes, parentVar, path = []) {
    const blocks = [];

    nodes.forEach((node, i) => {
        const varName = `id_${[...path, i].join('_')}`;
        const rawChildSnippet = stringifySnippet(node.msg.message);

        let childSnippet = injectParentKey(rawChildSnippet, parentVar);
        childSnippet = injectProtocolKey(childSnippet, parentVar);
        childSnippet = injectTargetKey(childSnippet, parentVar);

        const childOptions = stringifySnippet(node.relayOptions);
        blocks.push(`const ${varName} = await sock.relayMessage(\n  m.chat,\n  ${indentBlock(childSnippet)},\n  ${indentBlock(childOptions)}\n);`);

        if (node.children.length) {
            blocks.push(...buildChildScript(node.children, varName, [...path, i]));
        }
    });

    return blocks;
}

function buildRelayScript(snippetMessage, options, childTree) {
    if (!childTree.length) {
        return `await sock.relayMessage(\n  m.chat,\n  ${indentBlock(snippetMessage)},\n  ${indentBlock(options)}\n);`;
    }

    const parentBlock = `const newParentId = await sock.relayMessage(\n  m.chat,\n  ${indentBlock(snippetMessage)},\n  ${indentBlock(options)}\n);`;
    const childBlocks = buildChildScript(childTree, 'newParentId');

    return [parentBlock, ...childBlocks, 'return newParentId;'].join('\n\n');
}

function stringify(obj) {
    return JSON.stringify(obj, (key, value) => {
        if (Buffer.isBuffer(value)) return value.toString('base64');
        if (value?.type === 'Buffer' && Array.isArray(value.data)) {
            return Buffer.from(value.data).toString('base64');
        }
        return value;
    }, 2);
}

function indentBlock(str, level = 1) {
    const pad = '  '.repeat(level);
    return str.split('\n').map((line, i) => (i === 0 ? line : pad + line)).join('\n');
}

function stringifySnippet(obj) {
    const raws = [];
    const json = JSON.stringify(obj, (key, value) => {
        if (key === 'unifiedResponse' && value && typeof value === 'object' && typeof value.data === 'string') {
            try {
                const decoded = Buffer.from(value.data, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                const id = raws.length;
                raws.push(`Buffer.from(JSON.stringify(${JSON.stringify(parsed, null, 2)})).toString('base64')`);
                return { data: `__RAW_${id}__` };
            } catch {}
        }
        if (key === 'buttonParamsJson' && typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                const id = raws.length;
                raws.push(`JSON.stringify(${JSON.stringify(parsed, null, 2)})`);
                return `__RAW_${id}__`;
            } catch {}
        }
        if (Buffer.isBuffer(value)) return value.toString('base64');
        if (value?.type === 'Buffer' && Array.isArray(value.data)) {
            return Buffer.from(value.data).toString('base64');
        }
        return value;
    }, 2);

    let code = json.replace(/^(\s*)"([^"]+)":/gm, (_, indent, key) => `${indent}${key}:`);
    code = code.split('\n').map((line) => {
        const match = line.match(/^(\s*).*"__RAW_(\d+)__"/);
        if (!match) return line;
        const [, indent, id] = match;
        const block = raws[Number(id)].split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
        return line.replace(`"__RAW_${id}__"`, block);
    }).join('\n');

    return code;
}
