const { runUserCode } = require('../../library/evalRunner');

const LOOKS_LIKE_TEXT = /^(text\/|application\/(javascript|json|x-javascript|typescript))/i;

/**
 * Extracts executable code from a quoted message or document.
 * @param {object} m
 * @returns {Promise<{code?: string, error?: string}>}
 */
async function getCodeFromQuoted(m) {
    const q = m?.quoted;
    if (!q) return { error: 'Reply pesan atau file yang mau di-run dulu ya kak.' };

    const mime = q.mimetype || q.mime || '';
    const isDoc = q.mtype === 'documentMessage' || q.mtype === 'document' || /document/i.test(q.mtype || '');

    if (isDoc || (typeof q.download === 'function' && LOOKS_LIKE_TEXT.test(mime))) {
        let bytes;
        try {
            bytes = await q.download();
        } catch (err) {
            return { error: `Gagal download document: ${err?.message || err}` };
        }

        const text = Buffer.from(bytes).toString('utf8');
        if (!text.trim()) return { error: 'File yang di-reply kosong setelah di-download.' };
        return { code: text };
    }

    if (q.mtype && !['conversation', 'extendedTextMessage'].includes(q.mtype) && !q.text) {
        return { error: `Tipe media \`${q.mtype}\` tidak didukung untuk di-run. Reply teks atau file document.` };
    }

    const text = q.text;
    if (!text || !text.trim()) return { error: 'Pesan yang di-reply tidak ada teks/kodenya.' };
    return { code: text };
}

module.exports = {
    name: 'run',
    command: ['run', 'runcode', 'runfile', 'execfile'],
    tags: ['owner'],
    help: ['run (reply pesan/document)'],
    isOwner: true,

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { reply, store, config }) {
        const { code, error } = await getCodeFromQuoted(m);
        if (error) return reply(`❌ ${error}`);
        if (!code.trim()) return reply('❌ Code kosong.');

        try {
            const output = await runUserCode(code, m, sock, store, config);
            return reply(output);
        } catch (err) {
            return reply(`❌ Kode gagal dijalankan: ${err?.message || err}`);
        }
    }
};
