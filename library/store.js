const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { proto, getContentType, generateWAMessage, generateWAMessageFromContent, generateMessageIDV2 } = require('@whiskeysockets/baileys');

/**
 * Serializes WebSocket node for SQLite storage.
 */
function serializeNode(value) {
    return JSON.stringify(value, (_, v) => {
        if (Buffer.isBuffer(v)) {
            return { type: 'Buffer', data: v.toString('base64') };
        }
        if (v instanceof Uint8Array) {
            return { type: 'Buffer', data: Buffer.from(v).toString('base64') };
        }
        return v;
    });
}

/**
 * Deserializes WebSocket node from SQLite storage.
 */
function deserializeNode(value) {
    if (!value) return null;
    return JSON.parse(value, (_, v) => {
        if (v && v.type === 'Buffer') {
            if (typeof v.data === 'string') {
                return Buffer.from(v.data, 'base64');
            }
            if (Array.isArray(v.data)) {
                return Buffer.from(v.data);
            }
        }
        return v;
    });
}

/**
 * Normalizes timestamps from Baileys which can be a Long/object, number, bigint, or string.
 */
function parseTimestamp(ts) {
    if (ts == null) return Math.floor(Date.now() / 1000);
    if (typeof ts === 'object' && typeof ts.toNumber === 'function') return ts.toNumber();
    if (typeof ts === 'object' && 'low' in ts) return ts.low;
    if (typeof ts === 'bigint') return Number(ts);
    const n = Number(ts);
    return isNaN(n) ? Math.floor(Date.now() / 1000) : Math.floor(n);
}

/**
 * Unwraps nested message structures (ephemeral, viewOnce, documentWithCaption, etc.)
 */
function unwrapMessage(msg) {
    if (!msg) return { type: 'empty', message: null, isViewOnce: false, isEphemeral: false };
    let message = msg.message;
    if (!message) {
        if (msg.messageStubType) {
            return { type: 'stubMessage', message: null, isViewOnce: false, isEphemeral: false };
        }
        return { type: 'empty', message: null, isViewOnce: false, isEphemeral: false };
    }
    let isViewOnce = false;
    let isEphemeral = false;

    if (message) {
        if (message.ephemeralMessage) {
            isEphemeral = true;
            message = message.ephemeralMessage.message;
        }
        if (message?.viewOnceMessage) {
            isViewOnce = true;
            message = message.viewOnceMessage.message;
        } else if (message?.viewOnceMessageV2) {
            isViewOnce = true;
            message = message.viewOnceMessageV2.message;
        } else if (message?.viewOnceMessageV2Extension) {
            isViewOnce = true;
            message = message.viewOnceMessageV2Extension.message;
        } else if (message?.documentWithCaptionMessage) {
            message = message.documentWithCaptionMessage.message;
        }
    }

    const type = message ? (getContentType(message) || 'unknown') : 'empty';
    return { type, message, isViewOnce, isEphemeral };
}

/**
 * Maps granular Baileys message types to high-level categories.
 */
function categorizeType(type) {
    switch (type) {
        case 'conversation':
        case 'extendedTextMessage':
            return 'text';
        case 'imageMessage':
            return 'image';
        case 'videoMessage':
        case 'ptvMessage':
            return 'video';
        case 'audioMessage':
            return 'audio';
        case 'stickerMessage':
            return 'sticker';
        case 'documentMessage':
            return 'document';
        case 'contactMessage':
        case 'contactsArrayMessage':
            return 'contact';
        case 'locationMessage':
        case 'liveLocationMessage':
            return 'location';
        case 'reactionMessage':
            return 'reaction';
        case 'pollCreationMessage':
        case 'pollCreationMessageV3':
        case 'pollUpdateMessage':
            return 'poll';
        case 'protocolMessage':
            return 'protocol';
        case 'buttonsMessage':
        case 'buttonsResponseMessage':
        case 'templateMessage':
        case 'templateButtonReplyMessage':
        case 'listMessage':
        case 'listResponseMessage':
        case 'interactiveMessage':
        case 'interactiveResponseMessage':
            return 'interactive';
        default:
            return 'other';
    }
}

/**
 * Extracts text/body content from unwrapped message based on its type.
 */
function extractBody(type, message) {
    if (!message) return null;
    try {
        switch (type) {
            case 'conversation':
                return message.conversation || null;
            case 'extendedTextMessage':
                return message.extendedTextMessage?.text || null;
            case 'imageMessage':
                return message.imageMessage?.caption || null;
            case 'videoMessage':
                return message.videoMessage?.caption || null;
            case 'documentMessage':
                return message.documentMessage?.caption || message.documentMessage?.fileName || null;
            case 'locationMessage':
                return message.locationMessage?.name || message.locationMessage?.address || 
                    (message.locationMessage?.degreesLatitude ? `${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}` : null);
            case 'liveLocationMessage':
                return message.liveLocationMessage?.caption || 
                    (message.liveLocationMessage?.degreesLatitude ? `${message.liveLocationMessage.degreesLatitude}, ${message.liveLocationMessage.degreesLongitude}` : null);
            case 'contactMessage':
                return message.contactMessage?.displayName || message.contactMessage?.vcard || null;
            case 'reactionMessage':
                return message.reactionMessage?.text || null;
            case 'pollCreationMessage':
                return message.pollCreationMessage?.name || null;
            case 'pollCreationMessageV3':
                return message.pollCreationMessageV3?.name || null;
            case 'listResponseMessage':
                return message.listResponseMessage?.title || message.listResponseMessage?.singleSelectReply?.selectedRowId || null;
            case 'buttonsResponseMessage':
                return message.buttonsResponseMessage?.selectedDisplayText || message.buttonsResponseMessage?.selectedButtonId || null;
            case 'templateButtonReplyMessage':
                return message.templateButtonReplyMessage?.selectedDisplayText || message.templateButtonReplyMessage?.selectedId || null;
            default:
                return null;
        }
    } catch {
        return null;
    }
}

/**
 * Extracts media metadata (mimetype, media flag).
 */
function extractMediaInfo(type, message) {
    if (!message) return { hasMedia: 0, mediaMimeType: null };
    try {
        switch (type) {
            case 'imageMessage':
                return { hasMedia: 1, mediaMimeType: message.imageMessage?.mimetype || 'image/jpeg' };
            case 'videoMessage':
                return { hasMedia: 1, mediaMimeType: message.videoMessage?.mimetype || 'video/mp4' };
            case 'audioMessage':
                return { hasMedia: 1, mediaMimeType: message.audioMessage?.mimetype || 'audio/ogg' };
            case 'stickerMessage':
                return { hasMedia: 1, mediaMimeType: message.stickerMessage?.mimetype || 'image/webp' };
            case 'documentMessage':
                return { hasMedia: 1, mediaMimeType: message.documentMessage?.mimetype || 'application/octet-stream' };
            case 'ptvMessage':
                return { hasMedia: 1, mediaMimeType: message.ptvMessage?.mimetype || 'video/mp4' };
            default:
                return { hasMedia: 0, mediaMimeType: null };
        }
    } catch {
        return { hasMedia: 0, mediaMimeType: null };
    }
}

/**
 * SQLite-based Baileys Store using built-in node:sqlite
 */
class SqliteStore {
    constructor(options = {}) {
        this.dbPath = options.dbPath || path.join(__dirname, 'database', 'store.db');
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new DatabaseSync(this.dbPath);
        this.initDatabase();
        this.initStatements();
        this.initContacts();
        this.groupCache = new Map();
    }

    initDatabase() {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA busy_timeout = 5000;');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT NOT NULL,
                remoteJid TEXT NOT NULL,
                sender TEXT,
                fromMe INTEGER NOT NULL DEFAULT 0,
                pushName TEXT,
                messageType TEXT NOT NULL,
                category TEXT NOT NULL,
                body TEXT,
                mediaMimeType TEXT,
                hasMedia INTEGER DEFAULT 0,
                isViewOnce INTEGER DEFAULT 0,
                isEphemeral INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0,
                raw TEXT NOT NULL,
                messageTimestamp INTEGER,
                createdAt INTEGER NOT NULL,
                PRIMARY KEY (id, remoteJid)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_remoteJid ON messages(remoteJid);
            CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(messageType);
            CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category);
            CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(messageTimestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_isDeleted ON messages(isDeleted);

            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                name TEXT,
                notify TEXT,
                verifiedName TEXT,
                updatedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                name TEXT,
                unreadCount INTEGER DEFAULT 0,
                lastMessageTimestamp INTEGER,
                updatedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS group_metadata (
                id TEXT PRIMARY KEY,
                subject TEXT,
                metadata TEXT,
                updatedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT NOT NULL,
                chat TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                PRIMARY KEY(id, chat)
            );
            CREATE INDEX IF NOT EXISTS idx_nodes_chat ON nodes(chat);
            CREATE INDEX IF NOT EXISTS idx_nodes_id ON nodes(id);
        `);

        try {
            this.db.exec('ALTER TABLE messages ADD COLUMN isDeleted INTEGER DEFAULT 0;');
        } catch {}
    }

    initStatements() {
        this.stmtInsertMessage = this.db.prepare(`
            INSERT OR REPLACE INTO messages (
                id, remoteJid, sender, fromMe, pushName, messageType, category, body,
                mediaMimeType, hasMedia, isViewOnce, isEphemeral, raw, messageTimestamp, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.stmtMarkMessageDeleted = this.db.prepare(`
            UPDATE messages SET isDeleted = 1 WHERE id = ? AND remoteJid = ?
        `);

        this.stmtInsertNode = this.db.prepare(`
            INSERT INTO nodes (id, chat, data) VALUES (?, ?, ?)
            ON CONFLICT(id, chat) DO UPDATE SET data = excluded.data, created_at = strftime('%s','now')
        `);

        this.stmtGetNode = this.db.prepare(`
            SELECT data FROM nodes WHERE id = ? AND chat = ? ORDER BY created_at DESC LIMIT 1
        `);

        this.stmtGetNodeById = this.db.prepare(`
            SELECT data FROM nodes WHERE id = ? ORDER BY created_at DESC LIMIT 1
        `);

        this.stmtDeleteNode = this.db.prepare(`
            DELETE FROM nodes WHERE id = ? AND chat = ?
        `);

        this.stmtDeleteNodeById = this.db.prepare(`
            DELETE FROM nodes WHERE id = ?
        `);

        this.stmtGetMessageById = this.db.prepare(`
            SELECT * FROM messages WHERE id = ? ORDER BY createdAt DESC LIMIT 1
        `);

        this.stmtGetMessageByJidAndId = this.db.prepare(`
            SELECT * FROM messages WHERE id = ? AND remoteJid = ? LIMIT 1
        `);

        this.stmtDeleteMessage = this.db.prepare(`
            DELETE FROM messages WHERE id = ? AND remoteJid = ?
        `);

        this.stmtClearChat = this.db.prepare(`
            DELETE FROM messages WHERE remoteJid = ?
        `);

        this.stmtUpsertContact = this.db.prepare(`
            INSERT OR REPLACE INTO contacts (id, name, notify, verifiedName, updatedAt)
            VALUES (?, ?, ?, ?, ?)
        `);

        this.stmtUpsertChat = this.db.prepare(`
            INSERT OR REPLACE INTO chats (id, name, unreadCount, lastMessageTimestamp, updatedAt)
            VALUES (?, ?, ?, ?, ?)
        `);

        this.stmtDeleteChat = this.db.prepare(`
            DELETE FROM chats WHERE id = ?
        `);

        this.stmtUpsertGroupMeta = this.db.prepare(`
            INSERT OR REPLACE INTO group_metadata (id, subject, metadata, updatedAt)
            VALUES (?, ?, ?, ?)
        `);

        this.stmtGetGroupMeta = this.db.prepare(`
            SELECT * FROM group_metadata WHERE id = ? LIMIT 1
        `);
    }

    initContacts() {
        const rawContacts = {};
        try {
            const rows = this.db.prepare('SELECT * FROM contacts').all();
            for (const r of rows) {
                rawContacts[r.id] = {
                    id: r.id,
                    name: r.name || r.notify,
                    notify: r.notify,
                    verifiedName: r.verifiedName
                };
            }
        } catch (err) {
            console.error('[Store] Failed to load contacts from SQLite:', err);
        }

        const self = this;
        this.contacts = new Proxy(rawContacts, {
            get(target, prop) {
                return target[prop];
            },
            set(target, prop, value) {
                target[prop] = value;
                if (typeof prop === 'string' && value && typeof value === 'object') {
                    try {
                        self.stmtUpsertContact.run(
                            prop,
                            value.name ?? value.notify ?? null,
                            value.notify ?? value.name ?? null,
                            value.verifiedName ?? null,
                            Date.now()
                        );
                    } catch (err) {
                        // ignore or log
                    }
                }
                return true;
            }
        });
    }

    /**
     * Parses and saves a Baileys WebMessageInfo message into SQLite.
     */
    saveMessage(msg) {
        if (!msg || !msg.key || !msg.key.id || !msg.key.remoteJid) return false;

        try {
            const id = msg.key.id;
            const remoteJid = msg.key.remoteJid;
            const fromMe = msg.key.fromMe ? 1 : 0;
            const participant = msg.key.participant || null;
            const sender = fromMe ? 'me' : (participant || remoteJid);
            const pushName = msg.pushName || null;
            const timestamp = parseTimestamp(msg.messageTimestamp);

            const { type: messageType, message: unwrapped, isViewOnce, isEphemeral } = unwrapMessage(msg);
            const category = categorizeType(messageType);
            const body = extractBody(messageType, unwrapped);
            const { hasMedia, mediaMimeType } = extractMediaInfo(messageType, unwrapped);
            const raw = JSON.stringify(msg);

            const protoKey = unwrapped?.protocolMessage?.key || msg.message?.protocolMessage?.key;
            if (protoKey?.id) {
                const targetJid = protoKey.remoteJid || remoteJid;
                this.markMessageDeleted(targetJid, protoKey.id);
            }

            this.stmtInsertMessage.run(
                id,
                remoteJid,
                sender ?? null,
                fromMe,
                pushName ?? null,
                messageType,
                category,
                body ?? null,
                mediaMimeType ?? null,
                hasMedia,
                isViewOnce ? 1 : 0,
                isEphemeral ? 1 : 0,
                raw,
                timestamp,
                Date.now()
            );

            return true;
        } catch (err) {
            console.error('[Store] Error saving message:', err);
            return false;
        }
    }

    /**
     * Reconstructs Baileys message object.
     * Supports both loadMessage(jid, id) and loadMessage(id, chat).
     */
    async loadMessage(a, b) {
        let id = null;
        let jid = null;
        if (typeof a === 'string' && (a.includes('@g.us') || a.includes('@s.whatsapp.net') || a.includes('@lid') || a.includes('@newsletter'))) {
            jid = a;
            id = b;
        } else {
            id = a;
            jid = b;
        }
        if (!id) return null;

        try {
            let row = null;
            if (jid) {
                row = this.stmtGetMessageByJidAndId.get(id, jid);
            }
            if (!row) {
                row = this.stmtGetMessageById.get(id);
            }
            if (!row || !row.raw) return null;

            const parsed = JSON.parse(row.raw);
            return proto.WebMessageInfo ? proto.WebMessageInfo.fromObject(parsed) : parsed;
        } catch (err) {
            console.error('[Store] Error loading message:', err);
            return null;
        }
    }

    loadMessageById(id) {
        return this.loadMessage(id);
    }

    /**
     * Saves a WebSocket binary node into SQLite.
     * @param {string} id
     * @param {string} chat
     * @param {object} node
     */
    saveNode(id, chat, node) {
        if (!id || !chat || !node) return false;
        try {
            this.stmtInsertNode.run(String(id), String(chat), serializeNode(node));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Loads a WebSocket binary node from SQLite.
     * @param {string} messageId
     * @param {string} [jid]
     */
    loadNode(messageId, jid) {
        if (!messageId) return null;
        try {
            let row = null;
            if (jid) {
                row = this.stmtGetNode.get(String(messageId), String(jid));
            }
            if (!row?.data) {
                row = this.stmtGetNodeById.get(String(messageId));
            }
            if (!row?.data) return null;
            return deserializeNode(row.data);
        } catch {
            return null;
        }
    }

    /**
     * Saves additional node attributes/content for CRM.
     */
    saveAdditionalNode(id, chat, content, attrs = {}) {
        if (!id || !chat) return false;
        try {
            const existing = this.stmtGetNode.get(String(id), String(chat));
            if (existing?.data) {
                const node = deserializeNode(existing.data);
                if (node && typeof node === 'object') {
                    node.content = content;
                    node.attrs = { ...node.attrs, ...attrs };
                    this.stmtInsertNode.run(String(id), String(chat), serializeNode(node));
                    return true;
                }
            }
            this.stmtInsertNode.run(
                String(id),
                String(chat),
                serializeNode({
                    tag: 'message',
                    attrs: {
                        id: String(id),
                        from: String(chat),
                        t: String(Math.floor(Date.now() / 1000)),
                        type: 'text',
                        ...attrs
                    },
                    content
                })
            );
            return true;
        } catch {
            return false;
        }
    }

    loadAdditionalNode(id, chat) {
        const node = this.loadNode(id, chat);
        return node?.content ?? null;
    }

    loadFullMessage(id, chat) {
        const node = this.loadNode(id, chat);
        return {
            message: this.loadMessage(id, chat),
            additionalNode: node?.content ?? null
        };
    }

    /**
     * Persists outgoing message and its additionalNodes for CRM relay reconstruction.
     */
    persistOutgoing(message, id, jid, options = {}) {
        queueMicrotask(() => {
            try {
                if (message) {
                    const fullMsg = proto.WebMessageInfo.fromObject(message);
                    this.saveMessage(fullMsg);
                }
                this.saveAdditionalNode(id, jid, options.additionalNodes || [], {
                    t: String(Math.floor(Date.now() / 1000)),
                    ...options.additionalAttributes
                });
            } catch {}
        });
    }

    /**
     * Filter messages by specific messageType (e.g. 'imageMessage') or category ('image', 'audio', 'text', etc.)
     */
    getMessagesByType(typeOrCategory, options = {}) {
        const {
            jid = null,
            fromMe = null,
            limit = 50,
            offset = 0,
            order = 'DESC'
        } = options;

        const conditions = [];
        const params = [];

        // Check if query matches a category or a messageType
        conditions.push('(messageType = ? OR category = ?)');
        params.push(typeOrCategory, typeOrCategory);

        if (jid) {
            conditions.push('remoteJid = ?');
            params.push(jid);
        }

        if (fromMe !== null && fromMe !== undefined) {
            conditions.push('fromMe = ?');
            params.push(fromMe ? 1 : 0);
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const sql = `
            SELECT id, remoteJid, sender, fromMe, pushName, messageType, category, body,
                   mediaMimeType, hasMedia, isViewOnce, isEphemeral, messageTimestamp, createdAt, raw
            FROM messages
            ${whereSql}
            ORDER BY messageTimestamp ${sortOrder}
            LIMIT ? OFFSET ?
        `;
        params.push(Number(limit) || 50, Number(offset) || 0);

        try {
            const rows = this.db.prepare(sql).all(...params);
            return this.formatRows(rows);
        } catch (err) {
            console.error('[Store] getMessagesByType error:', err);
            return [];
        }
    }

    /**
     * Flexible message query with multiple filters.
     */
    getMessages(options = {}) {
        const {
            jid = null,
            type = null,
            category = null,
            sender = null,
            fromMe = null,
            hasMedia = null,
            search = null,
            limit = 50,
            offset = 0,
            order = 'DESC'
        } = options;

        const conditions = [];
        const params = [];

        if (jid) {
            conditions.push('remoteJid = ?');
            params.push(jid);
        }
        if (type) {
            conditions.push('messageType = ?');
            params.push(type);
        }
        if (category) {
            conditions.push('category = ?');
            params.push(category);
        }
        if (sender) {
            conditions.push('sender = ?');
            params.push(sender);
        }
        if (fromMe !== null && fromMe !== undefined) {
            conditions.push('fromMe = ?');
            params.push(fromMe ? 1 : 0);
        }
        if (hasMedia !== null && hasMedia !== undefined) {
            conditions.push('hasMedia = ?');
            params.push(hasMedia ? 1 : 0);
        }
        if (search) {
            conditions.push('body LIKE ?');
            params.push(`%${search}%`);
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const sql = `
            SELECT id, remoteJid, sender, fromMe, pushName, messageType, category, body,
                   mediaMimeType, hasMedia, isViewOnce, isEphemeral, messageTimestamp, createdAt, raw
            FROM messages
            ${whereSql}
            ORDER BY messageTimestamp ${sortOrder}
            LIMIT ? OFFSET ?
        `;
        params.push(Number(limit) || 50, Number(offset) || 0);

        try {
            const rows = this.db.prepare(sql).all(...params);
            return this.formatRows(rows);
        } catch (err) {
            console.error('[Store] getMessages error:', err);
            return [];
        }
    }

    /**
     * Mengambil N pesan terbaru dari suatu JID / grup.
     * @param {string} jid JID grup atau chat (contoh: m.chat)
     * @param {number} limit Jumlah pesan yang ingin diambil (default: 5)
     */
    getmsg(jid, limit = 5) {
        if (typeof jid === 'number') {
            limit = jid;
            jid = null;
        }
        return this.getMessages({ jid: jid || null, limit: Number(limit) || 5 });
    }

    getMsg(jid, limit = 5) {
        return this.getmsg(jid, limit);
    }

    /**
     * Search text inside messages.
     */
    searchMessages(text, options = {}) {
        return this.getMessages({
            ...options,
            search: text
        });
    }

    /**
     * Get statistics of stored messages grouped by type and category.
     */
    getStats(jid = null) {
        try {
            let sql = `
                SELECT category, messageType, COUNT(*) as count
                FROM messages
            `;
            const params = [];
            if (jid) {
                sql += ' WHERE remoteJid = ?';
                params.push(jid);
            }
            sql += ' GROUP BY category, messageType ORDER BY count DESC';

            const rows = this.db.prepare(sql).all(...params);
            const totalRow = this.db.prepare(`SELECT COUNT(*) as total FROM messages ${jid ? 'WHERE remoteJid = ?' : ''}`).get(...params);

            const byCategory = {};
            const byType = {};

            for (const r of rows) {
                byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.count);
                byType[r.messageType] = (byType[r.messageType] || 0) + Number(r.count);
            }

            return {
                total: totalRow ? Number(totalRow.total) : 0,
                byCategory,
                byType
            };
        } catch (err) {
            console.error('[Store] getStats error:', err);
            return { total: 0, byCategory: {}, byType: {} };
        }
    }

    formatRows(rows) {
        return rows.map(r => ({
            id: r.id,
            remoteJid: r.remoteJid,
            sender: r.sender,
            fromMe: Boolean(r.fromMe),
            pushName: r.pushName,
            messageType: r.messageType,
            category: r.category,
            body: r.body,
            mediaMimeType: r.mediaMimeType,
            hasMedia: Boolean(r.hasMedia),
            isViewOnce: Boolean(r.isViewOnce),
            isEphemeral: Boolean(r.isEphemeral),
            messageTimestamp: r.messageTimestamp,
            createdAt: r.createdAt,
            getMessageObject: () => {
                try {
                    const parsed = JSON.parse(r.raw);
                    return proto.WebMessageInfo ? proto.WebMessageInfo.fromObject(parsed) : parsed;
                } catch {
                    return null;
                }
            }
        }));
    }

    deleteMessage(jid, id) {
        try {
            this.stmtDeleteMessage.run(id, jid);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Marks a message as deleted (revoked) without deleting its record.
     * @param {string} jid
     * @param {string} id
     */
    markMessageDeleted(jid, id) {
        if (!jid || !id) return false;
        try {
            this.stmtMarkMessageDeleted.run(id, jid);
            return true;
        } catch {
            return false;
        }
    }

    clearChat(jid) {
        try {
            this.stmtClearChat.run(jid);
            return true;
        } catch {
            return false;
        }
    }

    saveContact(contact) {
        if (!contact || !contact.id) return;
        this.contacts[contact.id] = {
            id: contact.id,
            name: contact.name || contact.notify,
            notify: contact.notify,
            verifiedName: contact.verifiedName
        };
    }

    saveChat(chat) {
        if (!chat || !chat.id) return;
        try {
            this.stmtUpsertChat.run(
                chat.id,
                chat.name ?? null,
                chat.unreadCount ?? 0,
                chat.conversationTimestamp ? parseTimestamp(chat.conversationTimestamp) : null,
                Date.now()
            );
        } catch (err) {
            // ignore
        }
    }

    deleteChat(jid) {
        try {
            this.stmtDeleteChat.run(jid);
        } catch {
            // ignore
        }
    }

    async fetchGroupMetadata(jid, groupMetadataFunction) {
        if (this.groupCache.has(jid)) {
            return this.groupCache.get(jid);
        }

        try {
            const cached = this.stmtGetGroupMeta.get(jid);
            if (cached && cached.metadata) {
                const parsed = JSON.parse(cached.metadata);
                this.groupCache.set(jid, parsed);
                return parsed;
            }
        } catch {
            // ignore
        }

        if (typeof groupMetadataFunction === 'function') {
            try {
                const metadata = await groupMetadataFunction(jid);
                if (metadata) {
                    this.groupCache.set(jid, metadata);
                    try {
                        this.stmtUpsertGroupMeta.run(
                            jid,
                            metadata.subject ?? null,
                            JSON.stringify(metadata),
                            Date.now()
                        );
                    } catch {
                        // ignore
                    }
                    return metadata;
                }
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * Cleanup messages older than maxDays (default: 30 days) to prevent unlimited file growth.
     */
    cleanOldMessages(maxDays = 30) {
        try {
            const cutoff = Math.floor(Date.now() / 1000) - (maxDays * 86400);
            const result = this.db.prepare('DELETE FROM messages WHERE messageTimestamp < ?').run(cutoff);
            return result.changes;
        } catch (err) {
            console.error('[Store] cleanOldMessages error:', err);
            return 0;
        }
    }

    /**
     * Binds store to Baileys socket or socket event emitter.
     * Hooks WebSocket CB:message, sendMessage, and relayMessage for CRM node capture.
     * @param {import('@whiskeysockets/baileys').WASocket|object} target
     */
    bind(target) {
        if (!target) return target;
        const sock = (target.ev && target.ws) ? target : null;
        const ev = target.ev || target;

        if (!ev || typeof ev.on !== 'function') return target;

        ev.on('messages.upsert', ({ messages }) => {
            if (Array.isArray(messages)) {
                for (const msg of messages) {
                    this.saveMessage(msg);
                }
            }
        });

        ev.on('messages.update', updates => {
            if (Array.isArray(updates)) {
                for (const update of updates) {
                    if (update.key?.id && update.key?.remoteJid) {
                        try {
                            const isRevoke = !update.update?.message || 
                                             update.update?.messageStubType === 2 ||
                                             update.update?.status === 0;

                            if (isRevoke) {
                                this.markMessageDeleted(update.key.remoteJid, update.key.id);
                                continue;
                            }

                            const existing = this.stmtGetMessageByJidAndId.get(update.key.id, update.key.remoteJid);
                            if (existing && existing.raw) {
                                const parsed = JSON.parse(existing.raw);
                                if (update.update?.message) {
                                    parsed.message = update.update.message;
                                }
                                if (update.update?.pushName) {
                                    parsed.pushName = update.update.pushName;
                                }
                                this.saveMessage(parsed);
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
            }
        });

        ev.on('messages.delete', item => {
            if (!item) return;
            if (Array.isArray(item.keys)) {
                for (const key of item.keys) {
                    if (key.remoteJid && key.id) {
                        this.markMessageDeleted(key.remoteJid, key.id);
                    }
                }
            }
        });

        ev.on('contacts.upsert', contacts => {
            if (Array.isArray(contacts)) {
                for (const c of contacts) {
                    this.saveContact(c);
                }
            }
        });

        ev.on('contacts.update', updates => {
            if (Array.isArray(updates)) {
                for (const u of updates) {
                    this.saveContact(u);
                }
            }
        });

        ev.on('chats.upsert', chats => {
            if (Array.isArray(chats)) {
                for (const c of chats) {
                    this.saveChat(c);
                }
            }
        });

        ev.on('chats.update', updates => {
            if (Array.isArray(updates)) {
                for (const u of updates) {
                    this.saveChat(u);
                }
            }
        });

        ev.on('chats.delete', deletions => {
            if (Array.isArray(deletions)) {
                for (const jid of deletions) {
                    this.deleteChat(jid);
                }
            }
        });

        ev.on('groups.update', updates => {
            if (Array.isArray(updates)) {
                for (const u of updates) {
                    if (u.id && this.groupCache.has(u.id)) {
                        const cached = this.groupCache.get(u.id);
                        Object.assign(cached, u);
                    }
                }
            }
        });

        if (sock) {
            if (sock.ws && typeof sock.ws.on === 'function' && !sock.ws.__crmBound) {
                sock.ws.on('CB:message', node => {
                    try {
                        const id = node?.attrs?.id;
                        if (!id) return;
                        const chat = node?.attrs?.from || node?.attrs?.recipient || node?.attrs?.participant;
                        if (!chat) return;
                        this.saveNode(id, chat, node);
                    } catch {}
                });
                sock.ws.__crmBound = true;
            }

            if (typeof sock.sendMessage === 'function' && !sock.sendMessage.__crmPatched) {
                const originalSendMessage = sock.sendMessage.bind(sock);
                sock.sendMessage = async (jid, content, options = {}) => {
                    const messageId = options.messageId || generateMessageIDV2();
                    const generated = await generateWAMessage(jid, content, {
                        ...options,
                        messageId,
                        userJid: sock.user?.id,
                        upload: sock.waUploadToServer
                    });
                    const sent = await originalSendMessage(jid, content, { ...options, messageId });
                    this.persistOutgoing(generated.message, messageId, jid, options);
                    return sent;
                };
                sock.sendMessage.__crmPatched = true;
            }

            if (typeof sock.relayMessage === 'function' && !sock.relayMessage.__crmPatched) {
                const originalRelayMessage = sock.relayMessage.bind(sock);
                sock.relayMessage = async (jid, content, options = {}) => {
                    const messageId = options.messageId || generateMessageIDV2();
                    const generated = generateWAMessageFromContent(jid, content, {
                        ...options,
                        messageId,
                        userJid: sock.user?.id,
                        upload: sock.waUploadToServer
                    });
                    const resultPromise = originalRelayMessage(jid, content, { ...options, messageId });
                    this.persistOutgoing(generated, messageId, jid, options);
                    return resultPromise;
                };
                sock.relayMessage.__crmPatched = true;
            }
        }

        return target;
    }
}

function makeSqliteStore(options = {}) {
    return new SqliteStore(options);
}

module.exports = makeSqliteStore;
