const sharp = require('sharp');

const TEXT_EXTENSIONS = new Set([
    'txt', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'json', 'jsonc', 'xml', 'yaml', 'yml', 'toml', 'ini',
    'env', 'md', 'mdx', 'html', 'htm', 'css', 'scss', 'sass',
    'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'php', 'java',
    'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'swift', 'kt',
    'sql', 'graphql', 'prisma', 'dockerfile', 'log', 'csv'
]);

const TEXT_LIMIT = 60000;

/**
 * Checks whether the given mime or file extension is plain text.
 * @param {string} mime
 * @param {string} fileName
 * @returns {boolean}
 */
function isTextFile(mime, fileName) {
    if (/^text\/|json|xml|javascript|typescript|markdown/i.test(mime)) return true;
    const ext = fileName?.split('.').pop()?.toLowerCase();
    return ext ? TEXT_EXTENSIONS.has(ext) : false;
}

/**
 * Builds small JPEG thumbnail buffer.
 * @param {Buffer} source
 * @returns {Promise<Buffer|undefined>}
 */
async function buildThumbnail(source) {
    try {
        return await sharp(source)
            .resize({ width: 120, withoutEnlargement: true })
            .jpeg({ quality: 40 })
            .toBuffer();
    } catch {
        return undefined;
    }
}

/**
 * Extracts a static frame from animated media or webp.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function extractStillFrame(buffer) {
    try {
        return await sharp(buffer, { animated: false }).toFormat('jpeg').toBuffer();
    } catch {
        return buffer;
    }
}

module.exports = {
    name: 'cat',
    command: ['cat'],
    tags: ['tools'],
    help: ['cat (reply dokumen/media)'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { reply }) {
        if (!m.quoted) return reply('Reply dokumen atau media yang mau dikonversi!');

        const isMedia = Boolean(
            m.quoted.mimetype ||
            m.quoted.mime ||
            m.quoted.mtype === 'documentMessage' ||
            m.quoted.mtype === 'imageMessage' ||
            m.quoted.mtype === 'videoMessage' ||
            m.quoted.mtype === 'audioMessage' ||
            m.quoted.mtype === 'stickerMessage' ||
            typeof m.quoted.download === 'function'
        );

        if (!isMedia) return reply('Pesan yang di-reply bukan dokumen/media.');

        let buffer;
        try {
            buffer = await m.quoted.download();
        } catch (err) {
            return reply(`Gagal mengunduh file: ${err?.message || 'file tidak tersedia.'}`);
        }

        if (!buffer || !buffer.length) {
            return reply('Gagal mengunduh file atau file kosong.');
        }

        const mime = m.quoted.mimetype || m.quoted.mime || '';
        const fileName = m.quoted.fileName || `file_${Date.now()}`;

        if (/^image\//i.test(mime) || m.quoted.mtype === 'stickerMessage' || /webp/i.test(mime)) {
            const jpegThumbnail = await buildThumbnail(buffer);
            return sock.sendMessage(m.chat, {
                image: buffer,
                mimetype: mime || 'image/jpeg',
                jpegThumbnail
            }, { quoted: m });
        }

        if (/^video\//i.test(mime) || m.quoted.mtype === 'videoMessage') {
            const stillFrame = await extractStillFrame(buffer);
            const jpegThumbnail = await buildThumbnail(stillFrame);
            return sock.sendMessage(m.chat, {
                video: buffer,
                mimetype: mime || 'video/mp4',
                jpegThumbnail
            }, { quoted: m });
        }

        if (/^audio\//i.test(mime) || m.quoted.mtype === 'audioMessage') {
            return sock.sendMessage(m.chat, {
                audio: buffer,
                mimetype: mime || 'audio/mpeg'
            }, { quoted: m });
        }

        if (isTextFile(mime, fileName)) {
            const content = Buffer.from(buffer).toString('utf-8');
            if (!content.trim()) return reply('File kosong atau tidak berisi teks yang bisa dibaca.');
            if (content.length > TEXT_LIMIT) {
                return reply(content.slice(0, TEXT_LIMIT) + '\n\n... (terpotong)');
            }
            return reply(content);
        }

        return sock.sendMessage(m.chat, {
            document: buffer,
            fileName,
            mimetype: mime || 'application/octet-stream'
        }, { quoted: m });
    }
};
